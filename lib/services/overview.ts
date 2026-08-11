import { getAdminDb } from "../db";
import { getRecentActivity } from "./activity";
import { getTrendingAgents } from "./trending";
import { enrichAgent } from "./agents";
import type { Agent, OverviewStats } from "../types";

/**
 * Overview / ecosystem intelligence. All numbers are computed from real
 * marketplace records — no hardcoded statistics.
 */
export async function getOverviewStats(): Promise<OverviewStats> {
  const db = getAdminDb();
  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [activeAgents, totalHires, completedTasks, transactions, newAgents, categoryCounts, protocolRows, recent] = await Promise.all([
    db.from("agents").select("id", { count: "exact", head: true }).eq("status", "active"),
    db.from("hires").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
    db.from("activity").select("id", { count: "exact", head: true }).eq("type", "task_completed"),
    db.from("transactions").select("id", { count: "exact", head: true }).eq("state", "confirmed"),
    db.from("agents").select("id", { count: "exact", head: true }).gte("created_at", since7d),
    db.from("agents").select("category"),
    db.from("agent_protocols").select("protocol"),
    getRecentActivity(12),
  ]);

  // Category + protocol popularity from the full listing tables.
  const categories = new Map<string, number>();
  for (const row of categoryCounts.data ?? []) {
    categories.set(row.category as string, (categories.get(row.category as string) ?? 0) + 1);
  }
  const protocols = new Map<string, number>();
  for (const row of protocolRows.data ?? []) {
    protocols.set(row.protocol as string, (protocols.get(row.protocol as string) ?? 0) + 1);
  }

  // Trending agents (top 5), enriched.
  const trending = await getTrendingAgents(5);
  const trendingAgents: Agent[] = [];
  for (const t of trending) {
    const { data } = await db.from("agents").select("*").eq("id", t.agentId).maybeSingle();
    if (data) trendingAgents.push(await enrichAgent(data));
  }

  return {
    active_agents: activeAgents.count ?? 0,
    total_hires: totalHires.count ?? 0,
    tasks_completed: completedTasks.count ?? 0,
    agent_transactions: transactions.count ?? 0,
    new_agents_7d: newAgents.count ?? 0,
    trending_agents: trendingAgents,
    popular_categories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([category, count]) => ({ category: category as OverviewStats["popular_categories"][number]["category"], count })),
    popular_protocols: [...protocols.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([protocol, count]) => ({ protocol: protocol as OverviewStats["popular_protocols"][number]["protocol"], count })),
    recent_activity: recent,
  };
}

export const OVERVIEW_WINDOWS = ["15m", "30m", "1h", "24h", "7d"] as const;
export type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number];

export function windowToMs(window: string): number {
  switch (window) {
    case "15m": return 15 * 60_000;
    case "30m": return 30 * 60_000;
    case "1h": return 60 * 60_000;
    case "24h": return 24 * 60 * 60_000;
    case "7d": return 7 * 86_400_000;
    default: return 24 * 60 * 60_000;
  }
}
