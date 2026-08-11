import { cookies } from "next/headers";
import { getAdminDb } from "../db";
import { serverEnv } from "../env";
import { AppError, ErrorCode } from "../errors";
import { generateId, generateSessionToken, hashSessionToken } from "./crypto";

export interface AuthSession {
  id: string;
  wallet_address: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

export interface AuthUser {
  wallet_address: string;
  chain_id: number;
  avatar_seed: string;
  display_name: string | null;
  is_agent_owner: boolean;
}

const SESSION_COOKIE = "agrid_session";

/** Create a session for a verified wallet and set the auth cookie. */
export async function createAuthSession(walletAddress: string): Promise<void> {
  const env = serverEnv();
  const db = getAdminDb();
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + env.AUTH_SESSION_TTL_SECONDS * 1000).toISOString();

  const { error } = await db.from("auth_sessions").insert({
    id: generateId("sess"),
    wallet_address: walletAddress.toLowerCase(),
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (error) {
    throw new AppError("SESSION_CREATE_FAILED", "Could not create session.", 500, { db: error.message });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_SECONDS,
  });
}

/** Validate the session cookie and return the authenticated wallet. */
export async function getSessionWallet(): Promise<{ wallet: string; chainId: number } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getAdminDb();
  const tokenHash = hashSessionToken(token);
  const { data, error } = await db
    .from("auth_sessions")
    .select("*")
    .eq("token_hash", tokenHash)
    .eq("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();
  if (error || !data) return null;
  const { data: user } = await db
    .from("users")
    .select("wallet_address, chain")
    .eq("wallet_address", data.wallet_address)
    .single();
  return { wallet: data.wallet_address, chainId: user?.chain ?? 97 };
}

/**
 * Require an authenticated session in a route handler.
 * Throws UNAUTHORIZED when the user is not logged in.
 */
export async function requireAuth(): Promise<{ wallet: string; chainId: number }> {
  const session = await getSessionWallet();
  if (!session) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "Connect your wallet and sign in to continue.", 401);
  }
  return session;
}

/** Get the signed-in user's marketplace profile (upserts on first login). */
export async function getAuthUser(wallet: string, chainId: number): Promise<AuthUser> {
  const db = getAdminDb();
  const { data } = await db
    .from("users")
    .select("wallet_address, chain, avatar_seed, display_name")
    .eq("wallet_address", wallet.toLowerCase())
    .single();
  if (data) {
    return {
      wallet_address: data.wallet_address,
      chain_id: data.chain,
      avatar_seed: data.avatar_seed,
      display_name: data.display_name,
      is_agent_owner: true,
    };
  }
  const { generateUserAvatarSeed } = await import("./crypto");
  const avatarSeed = generateUserAvatarSeed(wallet);
  const { error } = await db.from("users").insert({
    id: generateId("user"),
    wallet_address: wallet.toLowerCase(),
    chain: chainId,
    avatar_seed: avatarSeed,
    display_name: null,
  });
  if (error) {
    throw new AppError("USER_CREATE_FAILED", "Could not create user profile.", 500, { db: error.message });
  }
  return {
    wallet_address: wallet.toLowerCase(),
    chain_id: chainId,
    avatar_seed: avatarSeed,
    display_name: null,
    is_agent_owner: true,
  };
}

/** Revoke the current session: deletes the DB row AND clears the cookie. */
export async function revokeSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = getAdminDb();
    await db.from("auth_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hashSessionToken(token));
  }
  cookieStore.delete(SESSION_COOKIE);
}
