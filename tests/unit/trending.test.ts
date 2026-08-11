import { describe, expect, it } from "vitest";
import { computeScore, decay } from "../../lib/services/trending";

const WEIGHTS = { wHires: 3, wTasks: 2, wViews: 1, wExecutions: 2, wActivity: 1, windowHours: 168 };

describe("trending decay", () => {
  const now = Date.parse("2026-08-01T00:00:00Z");

  it("scores fresh events at full weight", () => {
    expect(decay(new Date(now - 1).toISOString(), 168, now)).toBeCloseTo(1, 5);
  });

  it("decays linearly to zero at the window edge", () => {
    expect(decay(new Date(now - 84 * 3600_000).toISOString(), 168, now)).toBeCloseTo(0.5, 5);
    expect(decay(new Date(now - 168 * 3600_000).toISOString(), 168, now)).toBe(0);
    expect(decay(new Date(now - 200 * 3600_000).toISOString(), 168, now)).toBe(0);
  });

  it("clamps future timestamps to full weight", () => {
    expect(decay(new Date(now + 1000).toISOString(), 168, now)).toBe(1);
  });
});

describe("trending score computation", () => {
  it("applies the configured weights", () => {
    const score = computeScore(
      { recentHires: 10, recentTasks: 5, recentViews: 100, recentExecutions: 2, recentActivity: 7 },
      WEIGHTS,
    );
    expect(score).toBe(3 * 10 + 2 * 5 + 1 * 100 + 2 * 2 + 1 * 7);
  });

  it("weights hires more heavily than views", () => {
    const hires = computeScore({ recentHires: 10, recentTasks: 0, recentViews: 0, recentExecutions: 0, recentActivity: 0 }, WEIGHTS);
    const views = computeScore({ recentHires: 0, recentTasks: 0, recentViews: 25, recentExecutions: 0, recentActivity: 0 }, WEIGHTS);
    // 10 hires × wHires(3) = 30 > 25 views × wViews(1)
    expect(hires).toBeGreaterThan(views);
  });

  it("returns zero for an idle agent", () => {
    expect(computeScore({ recentHires: 0, recentTasks: 0, recentViews: 0, recentExecutions: 0, recentActivity: 0 }, WEIGHTS)).toBe(0);
  });

  it("is configurable — higher view weight changes rankings", () => {
    const viewsHeavy = { ...WEIGHTS, wViews: 10 };
    const base = computeScore({ recentHires: 1, recentTasks: 0, recentViews: 1, recentExecutions: 0, recentActivity: 0 }, WEIGHTS);
    const heavy = computeScore({ recentHires: 1, recentTasks: 0, recentViews: 1, recentExecutions: 0, recentActivity: 0 }, viewsHeavy);
    expect(heavy).toBeGreaterThan(base);
  });
});
