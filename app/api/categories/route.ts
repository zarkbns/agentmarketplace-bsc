import { handle, ok } from "@/lib/api/response";
import { getAdminDb } from "@/lib/db";
import { PROTOCOLS, type AgentCategory } from "@/lib/types";

/** GET /api/categories — marketplace categories and protocol/ecosystem filters. */
export const GET = handle(async () => {
  const db = getAdminDb();
  const { data: categoryRows } = await db.from("agents").select("category");
  const { data: protocolRows } = await db.from("agent_protocols").select("protocol, network");

  const categories = new Map<string, number>();
  for (const row of categoryRows ?? []) {
    categories.set(row.category as string, (categories.get(row.category as string) ?? 0) + 1);
  }
  const protocols = new Map<string, { count: number; networks: Set<string> }>();
  for (const row of protocolRows ?? []) {
    const entry = protocols.get(row.protocol) ?? { count: 0, networks: new Set<string>() };
    entry.count += 1;
    entry.networks.add(row.network as string);
    protocols.set(row.protocol, entry);
  }

  return ok({
    categories: [...categories.entries()]
      .map(([category, count]) => ({ category: category as AgentCategory, count }))
      .sort((a, b) => b.count - a.count),
    protocols: PROTOCOLS.map((id) => {
      const p = protocols.get(id);
      return { protocol: id, count: p?.count ?? 0, networks: p ? [...p.networks] : ["bsc-mainnet"] };
    }).filter((p) => p.count > 0),
  });
});
