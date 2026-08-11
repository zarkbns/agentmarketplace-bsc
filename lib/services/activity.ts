import { getAdminDb } from "../db";
import { generateId } from "../auth/crypto";
import type { ActivityType } from "../types";

/**
 * Marketplace activity feed. Records real events only — never fabricated
 * blockchain activity.
 */
export async function recordActivity(input: {
  type: ActivityType;
  agentId?: string | null;
  userWallet?: string | null;
  transactionHash?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  const db = getAdminDb();
  await db.from("activity").insert({
    id: generateId("act"),
    type: input.type,
    agent_id: input.agentId ?? null,
    user_wallet: input.userWallet?.toLowerCase() ?? null,
    transaction_hash: input.transactionHash ?? null,
    payload: input.payload ?? null,
  });
}

export async function getRecentActivity(limit = 30): Promise<
  { id: string; type: ActivityType; agent_id: string | null; user_wallet: string | null; transaction_hash: string | null; payload: Record<string, unknown> | null; created_at: string }[]
> {
  const db = getAdminDb();
  const { data, error } = await db.from("activity").select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data ?? [];
}
