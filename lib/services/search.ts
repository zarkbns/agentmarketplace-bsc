import { getAdminDb } from "../db";
import { AppError } from "../errors";
import type { Agent, AgentCategory } from "../types";
import { enrichAgent } from "./agents";

/**
 * Agent discovery — server-side search, filter, sort and pagination.
 * The browser never receives the full agent table.
 *
 * The filtering/sorting logic is pure (unit-testable); only the final
 * query execution touches the database.
 */

export interface SearchInput {
  q?: string;
  category?: AgentCategory | AgentCategory[];
  protocol?: string | string[];
  pricingModel?: string;
  status?: string;
  verification?: string;
  minPrice?: number;
  maxPrice?: number;
  minSuccessRate?: number; // 0..1
  sort?: "relevance" | "trending" | "newest" | "most_hired" | "reputation" | "success_rate" | "lowest_price";
  page?: number;
  pageSize?: number;
  newlyListedDays?: number;
  trendingWindowHours?: number;
}

export interface SearchResult {
  agents: Agent[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

/** Pure: relevance ranking — name > capabilities > description. */
export function scoreRelevance(agent: Pick<Agent, "name" | "description" | "capabilities">, q: string): number {
  const needle = q.toLowerCase().trim();
  if (!needle) return 0;
  const name = agent.name.toLowerCase();
  const desc = (agent.description ?? "").toLowerCase();
  const caps = agent.capabilities.map((c) => c.capability.toLowerCase()).join(" ");
  if (name === needle) return 100;
  if (name.startsWith(needle)) return 80;
  if (name.includes(needle)) return 60;
  if (caps.includes(needle)) return 40;
  if (desc.includes(needle)) return 20;
  return 0;
}

/** Pure: sort an agent list by a sort key. */
export function sortAgents<T extends { created_at: string }>(
  agents: T[],
  key: SearchInput["sort"],
  relevanceScores: Map<string, number> = new Map(),
): T[] {
  const arr = [...agents];
  switch (key) {
    case "newest":
      return arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "lowest_price": {
      const price = (a: T) => Number((a as { price?: string }).price ?? 0);
      return arr.sort((a, b) => price(a) - price(b));
    }
    case "most_hired": {
      const hires = (a: T) => Number((a as { hire_count?: number }).hire_count ?? 0);
      return arr.sort((a, b) => hires(b) - hires(a));
    }
    case "success_rate": {
      const sr = (a: T) => Number((a as { performance?: { success_rate: number | null } | null }).performance?.success_rate ?? -1);
      return arr.sort((a, b) => sr(b) - sr(a));
    }
    case "reputation": {
      const rep = (a: T) => Number((a as { reputation_score?: number }).reputation_score ?? 0);
      return arr.sort((a, b) => rep(b) - rep(a));
    }
    case "trending": {
      const tr = (a: T) => Number((a as { trending_score?: number }).trending_score ?? 0);
      return arr.sort((a, b) => tr(b) - tr(a));
    }
    case "relevance":
    default:
      return arr.sort((a, b) => {
        const sa = relevanceScores.get((a as unknown as { id: string }).id) ?? 0;
        const sb = relevanceScores.get((b as unknown as { id: string }).id) ?? 0;
        return sb - sa || (b as { created_at: string }).created_at.localeCompare((a as { created_at: string }).created_at);
      });
  }
}

/** Pure: price filter with stringified-decimal prices. */
export function passesPriceFilter(price: string, min?: number, max?: number): boolean {
  const value = Number(price);
  if (Number.isNaN(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/** Pure: success-rate filter (null performance fails the filter). */
export function passesSuccessRateFilter(successRate: number | null | undefined, min: number): boolean {
  return successRate !== null && successRate !== undefined && successRate >= min;
}

export async function searchAgents(input: SearchInput): Promise<SearchResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  const db = getAdminDb();

  const categories = input.category
    ? (Array.isArray(input.category) ? input.category : [input.category])
    : null;
  const protocols = input.protocol
    ? (Array.isArray(input.protocol) ? input.protocol : [input.protocol])
    : null;

  let query = db.from("agents").select("*");
  if (categories) query = query.in("category", categories);
  if (input.status) query = query.eq("status", input.status);
  if (input.pricingModel) query = query.eq("pricing_model", input.pricingModel);
  if (input.verification) query = query.eq("verification_status", input.verification);
  if (input.newlyListedDays) {
    const since = new Date(Date.now() - input.newlyListedDays * 86_400_000).toISOString();
    query = query.gte("created_at", since);
  }
  if (input.q) {
    const like = `%${input.q.trim()}%`;
    query = query.or(`name.ilike.${like},description.ilike.${like}`);
  }

  const { data: rows, error } = await query
    .order("created_at", { ascending: false })
    .range(0, 1000);

  if (error) {
    throw new AppError("SEARCH_FAILED", "Agent search failed.", 500, { db: error.message });
  }

  let agents = await Promise.all((rows ?? []).map((r) => enrichAgent(r)));

  // Protocol filter (join-based, applied post-fetch — small volume).
  if (protocols) {
    const protocolSet = new Set(protocols);
    agents = agents.filter((a) => a.protocols.some((p) => protocolSet.has(p.protocol)));
  }
  // Price & success-rate filters.
  if (input.minPrice !== undefined || input.maxPrice !== undefined) {
    agents = agents.filter((a) => passesPriceFilter(a.price, input.minPrice, input.maxPrice));
  }
  if (input.minSuccessRate !== undefined) {
    const minSuccessRate = input.minSuccessRate;
    agents = agents.filter((a) => passesSuccessRateFilter(a.performance?.success_rate, minSuccessRate));
  }

  // Trending scores (for trending sort and display).
  if (input.sort === "trending") {
    const { computeTrendingScores } = await import("./trending");
    const scores = await computeTrendingScores(
      agents.map((a) => a.id),
      input.trendingWindowHours,
    );
    for (const a of agents) a.trending_score = scores.get(a.id) ?? 0;
  }

  // Relevance scoring for query results.
  const relevance = new Map<string, number>();
  if (input.q) {
    for (const a of agents) relevance.set(a.id, scoreRelevance(a, input.q));
  }

  const sorted = sortAgents(agents, input.sort ?? "relevance", relevance);
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const paged = sorted.slice(start, start + pageSize);

  return { agents: paged, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
