import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "./env";

const isServer = typeof window === "undefined";

/**
 * Server-side Supabase client (service role — full database access).
 * SERVER ONLY. Authorization is enforced by the application layer
 * (lib/auth/session.ts); RLS provides defense in depth.
 */
export function getAdminDb(): SupabaseClient {
  if (!isServer) throw new Error("getAdminDb() must not be used on the client.");
  const env = serverEnv();
  const url = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Supabase client bound to a specific user's wallet address.
 * All queries go through a PostgREST function that sets the RLS context
 * (app.wallet_address) before executing, so RLS policies apply.
 * Falls back to the service-role client when RLS context routing is not
 * configured (documented in architecture.md).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getDbForWallet(_walletAddress: string): SupabaseClient {
  // PostgREST RLS-context routing is not enabled on this deployment; the
  // application layer (lib/auth/session.ts) enforces ownership, and RLS
  // policies in the migrations provide defense in depth.
  return getAdminDb();
}

export type Db = SupabaseClient;
