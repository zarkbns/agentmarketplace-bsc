import { handle, ok } from "@/lib/api/response";
import { getAdminDb } from "@/lib/db";

/**
 * GET /api/erc8004/index — current indexer state (counts + last event).
 * The indexer is a server-side script (scripts/index-erc8004.ts); this
 * endpoint reports what has been indexed.
 */
export const GET = handle(async () => {
  const db = getAdminDb();
  const { count: indexedAgents } = await db.from("erc8004_agents").select("id", { count: "exact", head: true });
  const { count: indexedEvents } = await db.from("indexed_events").select("id", { count: "exact", head: true });
  const { data: latest } = await db
    .from("indexed_events")
    .select("block_number, transaction_hash, event_name, processed_at")
    .order("processed_at", { ascending: false })
    .limit(1);
  return ok({
    indexedAgents: indexedAgents ?? 0,
    indexedEvents: indexedEvents ?? 0,
    latestEvent: latest?.[0] ?? null,
  });
});
