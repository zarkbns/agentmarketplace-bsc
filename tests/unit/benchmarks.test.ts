import { describe, expect, it } from "vitest";
import { summarizeAdvantage } from "../../lib/services/benchmarks";
import type { AgentAdvantage } from "../../lib/types";

function record(overrides: Partial<AgentAdvantage>): AgentAdvantage {
  return {
    id: "r",
    agent_id: "a",
    task_description: "Benchmark task",
    benchmark_type: "manual_vs_agent",
    agent_execution_time_seconds: null,
    manual_execution_time_seconds: null,
    agent_cost: null,
    manual_cost: null,
    agent_output: null,
    manual_output: null,
    agent_quality_score: null,
    manual_quality_score: null,
    evaluation_notes: null,
    verified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Agent Advantage summary", () => {
  it("returns empty aggregates for no records", () => {
    const s = summarizeAdvantage([]);
    expect(s.recordCount).toBe(0);
    expect(s.avgTimeSavingPct).toBeNull();
    expect(s.avgCostSavingPct).toBeNull();
    expect(s.avgQualityDelta).toBeNull();
  });

  it("computes average time savings", () => {
    const s = summarizeAdvantage([
      record({ agent_execution_time_seconds: 120, manual_execution_time_seconds: 600 }),
      record({ agent_execution_time_seconds: 60, manual_execution_time_seconds: 300 }),
    ]);
    expect(s.recordCount).toBe(2);
    expect(s.avgTimeSavingPct).toBeCloseTo(80, 5); // agent 5x faster in both
  });

  it("computes average cost savings", () => {
    const s = summarizeAdvantage([
      record({ agent_cost: 5, manual_cost: 100 }),
      record({ agent_cost: 10, manual_cost: 50 }),
    ]);
    // savings: 95% and 80% → avg 87.5%
    expect(s.avgCostSavingPct).toBeCloseTo(87.5, 5);
  });

  it("computes average quality delta", () => {
    const s = summarizeAdvantage([
      record({ agent_quality_score: 8, manual_quality_score: 6 }),
      record({ agent_quality_score: 9, manual_quality_score: 9 }),
    ]);
    expect(s.avgQualityDelta).toBeCloseTo(1, 5);
  });

  it("skips records missing either side of a comparison", () => {
    const s = summarizeAdvantage([
      record({ agent_execution_time_seconds: 60, manual_execution_time_seconds: null }),
      record({ agent_execution_time_seconds: 120, manual_execution_time_seconds: 600 }),
    ]);
    expect(s.avgTimeSavingPct).toBeCloseTo(80, 5); // only the complete record counts
  });

  it("never divides by zero", () => {
    const s = summarizeAdvantage([record({ agent_cost: 5, manual_cost: 0 })]);
    expect(s.avgCostSavingPct).toBeNull();
  });
});
