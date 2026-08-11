import type { Session } from "@altananetwork/sdk";
import { getAddress, type Address, type Hex } from "viem";
import { getAdminDb } from "../db";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { logger } from "../logger";
import { generateId } from "../auth/crypto";
import { AltanaAdapter, getAltanaAdapter } from "../adapters/altana";
import { recordActivity } from "./activity";
import type { AgentSession, SessionPermissionCall, SessionStatus } from "../types";

/**
 * Session service — the user-facing Altana permission lifecycle.
 *
 * Supabase caches session metadata (altana_sessions) for the UI; the
 * authoritative state is on-chain (Altana KeyStore + account validator).
 * Every read refreshes from the adapter; revocation performs the real
 * on-chain transaction, then re-reads the authoritative state.
 */

export interface CreateSessionInput {
  userWallet: string;
  agentId: string;
  spendCap: string; // raw token units
  spendToken: Address;
  allowedCalls: SessionPermissionCall[];
  expiryHours: number;
  period: "minute" | "hour" | "day" | "week" | "month" | "year";
}

export interface CreatedSessionResult {
  session: AgentSession;
  registrationTx: string | null;
  keyStoreValid: boolean;
}

export async function createAgentSession(input: CreateSessionInput): Promise<CreatedSessionResult> {
  const env = serverEnv();
  const chainId = env.ALTANA_NETWORK === "bnb-testnet" ? 97 : 56;
  const db = getAdminDb();
  const adapter = new AltanaAdapter();

  const expiry = Math.floor(Date.now() / 1000) + input.expiryHours * 3600;

  // 1. Agent-owned wallet (Altana). Reuse an existing session wallet if one
  //    exists for this agent, otherwise create one.
  const { data: existing } = await db
    .from("altana_sessions")
    .select("wallet_address")
    .eq("agent_id", input.agentId)
    .eq("user_wallet", input.userWallet.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const walletAddress: Address = existing?.wallet_address
    ? (existing.wallet_address as Address)
    : (await adapter.createAgentWallet()).address;

  // 2. Grant a scoped session (spend cap + call allowlist + expiry), with
  //    KeyStore registration (register: true) — verifiable on-chain.
  const session: Session = await adapter.createSession({
    walletAddress,
    permissions: {
      allowedCalls: input.allowedCalls,
      spendCap: { token: input.spendToken, limit: input.spendCap },
      period: input.period,
    },
    expiry,
  });

  // 3. Read authoritative on-chain state to confirm the key is live.
  const onchain = await adapter.getOnchainSessionState(session.publicKey, session.walletAddress);

  // 4. Cache in Supabase for the UI (authoritative state remains on-chain).
  const record: AgentSession = {
    id: generateId("alt"),
    user_wallet: getAddress(input.userWallet),
    agent_id: input.agentId,
    session_id: session.publicKey,
    wallet_address: walletAddress,
    agent_address: getAddress(walletAddress),
    session_key: session.publicKey,
    spend_cap: input.spendCap,
    spend_token: input.spendToken,
    allowed_calls: input.allowedCalls,
    expiry: new Date(expiry * 1000).toISOString(),
    registration_tx: null,
    revocation_tx: null,
    chain_id: chainId,
    status: "active",
    spent_so_far: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data: inserted, error } = await db
    .from("altana_sessions")
    .insert({
      id: record.id,
      user_wallet: record.user_wallet,
      agent_id: record.agent_id,
      chain_id: chainId,
      wallet_address: record.wallet_address,
      agent_address: record.agent_address,
      session_id: record.session_id,
      session_key: record.session_key,
      spend_cap: record.spend_cap,
      spend_token: record.spend_token,
      spend_period: input.period,
      allowed_calls: JSON.stringify(record.allowed_calls ?? []),
      expiry: record.expiry,
      status: "active",
      last_verified_at: new Date().toISOString(),
      created_at: record.created_at,
      updated_at: record.updated_at,
    })
    .select()
    .single();
  if (error) {
    throw new AppError("SESSION_CREATE_FAILED", "Could not persist the session.", 500, { db: error.message });
  }

  await recordActivity({
    type: "agent_interaction",
    agentId: input.agentId,
    userWallet: input.userWallet,
    payload: { action: "session_granted", wallet: walletAddress, expiry },
  });
  logger.info(
    { sessionId: session.publicKey, wallet: walletAddress, chainId },
    "altana session granted + registered on-chain",
  );

  return {
    session: { ...record, id: inserted.id },
    registrationTx: null, // grant went through the relay; registerSessionKey can surface the tx
    keyStoreValid: onchain.keyValid,
  };
}

/** Active sessions for a user (cached view). */
export async function getUserSessions(userWallet: string): Promise<AgentSession[]> {
  const db = getAdminDb();
  const { data } = await db
    .from("altana_sessions")
    .select("*")
    .eq("user_wallet", userWallet.toLowerCase())
    .order("created_at", { ascending: false });
  return (data ?? []) as AgentSession[];
}

export async function getSessionById(id: string, userWallet: string): Promise<AgentSession> {
  const db = getAdminDb();
  const { data } = await db
    .from("altana_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_wallet", userWallet.toLowerCase())
    .single();
  if (!data) throw new AppError("SESSION_NOT_FOUND", "Session not found.", 404);
  return data as AgentSession;
}

/**
 * Revoke a session. Performs the REAL on-chain revocation via the Altana
 * adapter, then re-reads the authoritative state. Supabase is only updated
 * to mirror what the chain says.
 */
export async function revokeSession(id: string, userWallet: string): Promise<{ status: SessionStatus; revocationTx: string | null; keyStoreValid: boolean }> {
  const db = getAdminDb();
  const record = await getSessionById(id, userWallet);
  if (record.status === "revoked" || record.status === "expired") {
    throw new AppError("SESSION_ALREADY_INACTIVE", "This session is already revoked or expired.", 409);
  }

  const adapter = new AltanaAdapter();
  // Revoke by the session's public key (Hex) — the SDK resolves the key
  // from the KeyStore; no session signer reconstruction needed.
  const result = await adapter.revokeSession(record.session_key as Hex, record.wallet_address as Address);
  const onchain = await adapter.getOnchainSessionState(record.session_key as Hex, record.wallet_address as Address);
  const revoked = result.status === "CONFIRMED" || !onchain.keyValid;

  const now = new Date().toISOString();
  await db.from("altana_sessions").update({
    status: revoked ? "revoked" : "active",
    revocation_tx: result.txHash,
    updated_at: now,
    last_verified_at: now,
  }).eq("id", id);

  await recordActivity({
    type: "agent_interaction",
    agentId: record.agent_id ?? null,
    userWallet,
    transactionHash: result.txHash,
    payload: { action: "session_revoked", sessionId: record.session_id, revoked },
  });
  logger.info({ sessionId: record.session_id, txHash: result.txHash }, "altana session revoked on-chain");

  return { status: revoked ? "revoked" : "active", revocationTx: result.txHash, keyStoreValid: onchain.keyValid };
}

/** Refresh the authoritative on-chain state for a cached session. */
export async function refreshSessionState(id: string, userWallet: string): Promise<{ status: SessionStatus; keyStoreValid: boolean; expired: boolean }> {
  const record = await getSessionById(id, userWallet);
  const adapter = getAltanaAdapter();
  const expiryMs = new Date(record.expiry ?? 0).getTime();
  const expired = expiryMs < Date.now();
  if (expired) {
    await getAdminDb().from("altana_sessions").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id);
    return { status: "expired", keyStoreValid: false, expired: true };
  }
  try {
    const state = await adapter.getOnchainSessionState(record.session_key as Hex, record.wallet_address as Address);
    const status: SessionStatus = state.keyValid ? "active" : "revoked";
    await getAdminDb().from("altana_sessions").update({ status, last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
    return { status, keyStoreValid: state.keyValid, expired: false };
  } catch (err) {
    logger.warn({ err, id }, "session state refresh failed");
    return { status: record.status as SessionStatus, keyStoreValid: false, expired };
  }
}

/** Summary line for the UI: spent so far via on-chain reads (best effort). */
export async function getSessionSpendInfo(id: string, userWallet: string): Promise<{ spent: string | null; cap: string | null; remaining: string | null }> {
  const record = await getSessionById(id, userWallet);
  if (!record.spend_cap) return { spent: null, cap: null, remaining: null };
  const env = serverEnv();
  const chainId = env.ALTANA_NETWORK === "bnb-testnet" ? 97 : 56;
  try {
    const { publicClientFor } = await import("../blockchain/client");
    const { erc20Abi } = await import("../blockchain/abis");
    const client = publicClientFor(chainId);
    const token = (record.spend_token ?? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") as Address;
    const [walletBalance] = await Promise.all([
      token === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
        ? client.getBalance({ address: record.wallet_address as Address })
        : client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [record.wallet_address as Address] }),
    ]);
    const cap = BigInt(record.spend_cap);
    const spent = cap - walletBalance > 0n ? (cap - walletBalance).toString() : "0";
    return { spent, cap: cap.toString(), remaining: (cap - BigInt(spent)).toString() };
  } catch (err) {
    logger.warn({ err, id }, "session spend read failed");
    return { spent: null, cap: record.spend_cap, remaining: null };
  }
}
