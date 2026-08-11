import { serverEnv } from "../env";
import { AppError } from "../errors";
import { getAdminDb, type Db } from "../db";
import { generateId, generateNonce } from "./crypto";

/**
 * One-time authentication nonces with replay protection.
 *
 * Flow: POST /api/auth/nonce creates a nonce (single-use, TTL'd).
 * POST /api/auth/verify consumes it atomically. A consumed or expired
 * nonce can never be reused, so a captured message+signature pair cannot
 * be replayed to create a second session.
 */
export interface AuthNonce {
  id: string;
  wallet_address: string;
  nonce: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export async function createAuthNonce(walletAddress: string, db: Db = getAdminDb()): Promise<AuthNonce> {
  const env = serverEnv();
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + env.AUTH_NONCE_TTL_SECONDS * 1000).toISOString();
  const record: AuthNonce = {
    id: generateId("nonce"),
    wallet_address: walletAddress.toLowerCase(),
    nonce,
    expires_at: expiresAt,
    consumed_at: null,
    created_at: new Date().toISOString(),
  };
  const { error } = await db.from("auth_nonces").insert(record);
  if (error) throw new AppError("NONCE_CREATE_FAILED", "Could not create nonce.", 500, { db: error.message });
  return record;
}

/**
 * Atomically consume a nonce. Returns the record only if it exists, is
 * unconsumed and not expired. Throws replay/expiry errors otherwise.
 */
export async function consumeAuthNonce(nonce: string, walletAddress: string, db: Db = getAdminDb()): Promise<AuthNonce> {
  const { data, error } = await db
    .from("auth_nonces")
    .select("*")
    .eq("nonce", nonce)
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();
  if (error || !data) {
    throw new AppError("INVALID_NONCE", "Unknown nonce. Request a new one.", 401);
  }
  if (data.consumed_at) {
    throw new AppError("NONCE_REUSED", "This nonce has already been used. Request a new one.", 401);
  }
  if (new Date(data.expires_at).getTime() < Date.now()) {
    throw new AppError("NONCE_EXPIRED", "This nonce has expired. Request a new one.", 401);
  }
  const now = new Date().toISOString();
  const { error: consumeError } = await db
    .from("auth_nonces")
    .update({ consumed_at: now })
    .eq("id", data.id)
    .eq("consumed_at", null); // compare-and-swap: only consume if still unconsumed
  if (consumeError) {
    throw new AppError("NONCE_REUSED", "This nonce has already been used. Request a new one.", 401);
  }
  return { ...data, consumed_at: now };
}

/** Expire old nonces (housekeeping — called opportunistically). */
export async function purgeExpiredNonces(db: Db = getAdminDb()): Promise<void> {
  await db.from("auth_nonces").delete().lt("expires_at", new Date().toISOString());
}
