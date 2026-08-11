import { describe, expect, it } from "vitest";
import { passesPriceFilter, passesSuccessRateFilter, scoreRelevance, sortAgents } from "../../lib/services/search";
import type { Agent } from "../../lib/types";

function makeAgent(overrides: Partial<Agent> & Pick<Agent, "id" | "name">): Agent {
  return {
    slug: overrides.id,
    description: null,
    category: "automation",
    status: "active",
    pricing_model: "per_task",
    price: "1",
    currency: "USDC",
    endpoint: null,
    metadata_uri: null,
    image_uri: null,
    verification_status: "unverified",
    registration_source: "marketplace",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    capabilities: [],
    protocols: [],
    performance: null,
    onchain: null,
    hire_count: 0,
    trending_score: 0,
    owner_wallet: null,
    onchain_agent_id: null,
    registry_address: null,
    ...overrides,
  };
}

describe("relevance scoring", () => {
  it("prefers exact name matches over partial and description matches", () => {
    const exact = makeAgent({ id: "a", name: "YieldGuard" });
    const partial = makeAgent({ id: "b", name: "YieldGuard Pro" });
    const desc = makeAgent({ id: "c", name: "Something", description: "great yieldguard features" });
    const caps = makeAgent({ id: "d", name: "Other", capabilities: [{ id: "c1", agent_id: "d", capability: "yieldguard", description: null }] });

    expect(scoreRelevance(exact, "yieldguard")).toBeGreaterThan(scoreRelevance(partial, "yieldguard"));
    expect(scoreRelevance(partial, "yieldguard")).toBeGreaterThan(scoreRelevance(caps, "yieldguard"));
    expect(scoreRelevance(caps, "yieldguard")).toBeGreaterThan(scoreRelevance(desc, "yieldguard"));
    expect(scoreRelevance(desc, "yieldguard")).toBeGreaterThan(0);
  });

  it("returns 0 for non-matching queries", () => {
    expect(scoreRelevance(makeAgent({ id: "a", name: "Foo" }), "pancakeswap")).toBe(0);
  });
});

describe("sorting", () => {
  it("sorts by newest", () => {
    const a = makeAgent({ id: "a", name: "A", created_at: "2026-01-01T00:00:00.000Z" });
    const b = makeAgent({ id: "b", name: "B", created_at: "2026-02-01T00:00:00.000Z" });
    expect(sortAgents([a, b], "newest").map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("sorts by lowest price", () => {
    const a = makeAgent({ id: "a", name: "A", price: "10" });
    const b = makeAgent({ id: "b", name: "B", price: "1" });
    expect(sortAgents([a, b], "lowest_price").map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("sorts by most hired", () => {
    const a = makeAgent({ id: "a", name: "A", hire_count: 2 });
    const b = makeAgent({ id: "b", name: "B", hire_count: 42 });
    expect(sortAgents([a, b], "most_hired").map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("sorts by success rate, agents without performance last", () => {
    const a = makeAgent({ id: "a", name: "A", performance: { agent_id: "a", success_rate: 0.95, tasks_completed: 10, average_execution_time_seconds: null, average_cost: null, currency: "USDC", evaluation_window_days: null, risk_metrics: null, updated_at: "" } });
    const b = makeAgent({ id: "b", name: "B", performance: { agent_id: "b", success_rate: 0.5, tasks_completed: 5, average_execution_time_seconds: null, average_cost: null, currency: "USDC", evaluation_window_days: null, risk_metrics: null, updated_at: "" } });
    const c = makeAgent({ id: "c", name: "C", performance: null });
    const sorted = sortAgents([c, a, b], "success_rate");
    expect(sorted.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("sorts by relevance using provided scores", () => {
    const a = makeAgent({ id: "a", name: "A" });
    const b = makeAgent({ id: "b", name: "B" });
    const scores = new Map([["b", 80], ["a", 20]]);
    expect(sortAgents([a, b], "relevance", scores).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("filters", () => {
  it("price filter respects min/max", () => {
    expect(passesPriceFilter("5", 1, 10)).toBe(true);
    expect(passesPriceFilter("0.5", 1)).toBe(false);
    expect(passesPriceFilter("50", undefined, 10)).toBe(false);
    expect(passesPriceFilter("abc")).toBe(false);
  });

  it("success rate filter requires a real value", () => {
    expect(passesSuccessRateFilter(0.9, 0.8)).toBe(true);
    expect(passesSuccessRateFilter(0.7, 0.8)).toBe(false);
    expect(passesSuccessRateFilter(null, 0.8)).toBe(false);
    expect(passesSuccessRateFilter(undefined, 0.8)).toBe(false);
  });
});
