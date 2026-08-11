import { getAdminDb } from "../db";
import { serverEnv } from "../env";

/**
 * Trending — a transparent, configurable score, not a raw sort by hires.
 *
 *   trending_score(agent) =
 *     w_hires      * recent_hires
 *   + w_tasks      * recent_task_volume
 *   + w_views      * recent_views
 *   + w_executions * recent_executions
 *   + w_activity   * recent_activity_events
 *
 * All signals are counts inside a rolling window (default 7 days), with a
 * linear time-decay: events closer to now weigh more. Weights and window are
 * environment-configurable (TRENDING_W_* / TRENDING_WINDOW_HOURS) and
 * documented in architecture.md §Trending.
 */

export interface TrendingWeights {
  wHires: number;
  wTasks: number;
  wViews: number;
  wExecutions: number;
  wActivity: number;
  windowHours: number;
}

export function getTrendingWeights(): TrendingWeights {
  const env = serverEnv();
  return {
    wHires: env.TRENDING_W_HIRES,
    wTasks: env.TRENDING_W_TASKS,
    wViews: env.TRENDING_W_VIEWS,
    wExecutions: env.TRENDING_W_EXECUTIONS,
    wActivity: env.TRENDING_W_ACTIVITY,
    windowHours: env.TRENDING_WINDOW_HOURS,
  };
}

/** Linear decay multiplier: 1 at now, → 0 at the edge of the window. */
export function decay(createdAt: string, windowHours: number, now = Date.now()): number {
  const t = new Date(createdAt).getTime();
  const ageHours = (now - t) / 3_600_000;
  if (ageHours <= 0) return 1;
  return Math.max(0, 1 - ageHours / windowHours);
}

/** Pure: compute a trending score from per-signal counts + decay. */
export function computeScore(
  signals: { recentHires: number; recentTasks: number; recentViews: number; recentExecutions: number; recentActivity: number },
  weights: TrendingWeights,
): number {
  const {
    wHires, wTasks, wViews, wExecutions, wActivity,
  } = weights;
  return (
    wHires * signals.recentHires +
    wTasks * signals.recentTasks +
    wViews * signals.recentViews +
    wExecutions * signals.recentExecutions +
    wActivity * signals.recentActivity
  );
}

export interface TrendingSignal {
  agentId: string;
  hires: { count: number; weighted: number };
  tasks: { count: number; weighted: number };
  views: { count: number; weighted: number };
  executions: { count: number; weighted: number };
  activity: { count: number; weighted: number };
  score: number;
}

/**
 * Compute trending scores for a set of agents using the activity feed,
 * hire records and view counts inside the window.
 */
export async function computeTrendingScores(agentIds: string[], windowHours?: number): Promise<Map<string, number>> {
  const db = getAdminDb();
  const weights = getTrendingWeights();
  const hours = windowHours ?? weights.windowHours;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const map = new Map<string, TrendingSignal>();
  for (const id of agentIds) {
    map.set(id, {
      agentId: id,
      hires: { count: 0, weighted: 0 },
      tasks: { count: 0, weighted: 0 },
      views: { count: 0, weighted: 0 },
      executions: { count: 0, weighted: 0 },
      activity: { count: 0, weighted: 0 },
      score: 0,
    });
  }

  // Hires within the window.
  const { data: hires } = await db
    .from("hires")
    .select("agent_id, created_at")
    .in("agent_id", agentIds)
    .gte("created_at", since);
  // Completed/failed tasks drive task volume.
  const { data: tasks } = await db
    .from("activity")
    .select("agent_id, type, created_at")
    .in("agent_id", agentIds)
    .in("type", ["task_completed", "task_failed"])
    .gte("created_at", since);
  // Views.
  const { data: views } = await db
    .from("agent_views")
    .select("agent_id, viewed_at")
    .in("agent_id", agentIds)
    .gte("viewed_at", since);
  // All other activity (excluding pure transaction noise is optional).
  const { data: activity } = await db
    .from("activity")
    .select("agent_id, type, created_at")
    .in("agent_id", agentIds)
    .notIn("type", ["task_completed", "task_failed"])
    .gte("created_at", since);

  const scores = new Map<string, number>();
  for (const agentId of agentIds) {
    const s = map.get(agentId)!;
    for (const h of hires ?? []) {
      if (h.agent_id !== agentId) continue;
      s.hires.count += 1;
      s.hires.weighted += decay(h.created_at, hours);
    }
    for (const t of tasks ?? []) {
      if (t.agent_id !== agentId) continue;
      s.tasks.count += 1;
      s.tasks.weighted += decay(t.created_at, hours);
    }
    for (const v of views ?? []) {
      if (v.agent_id !== agentId) continue;
      s.views.count += 1;
      s.views.weighted += decay(v.viewed_at, hours);
    }
    for (const a of activity ?? []) {
      if (a.agent_id !== agentId) continue;
      s.activity.count += 1;
      s.activity.weighted += decay(a.created_at, hours);
    }
    s.score = computeScore(
      {
        recentHires: s.hires.weighted,
        recentTasks: s.tasks.weighted,
        recentViews: s.views.weighted,
        recentExecutions: s.executions.weighted,
        recentActivity: s.activity.weighted,
      },
      weights,
    );
    scores.set(agentId, s.score);
  }
  return scores;
}

/** Top-N trending agents across the whole marketplace. */
export async function getTrendingAgents(limit = 10, windowHours?: number): Promise<{ agentId: string; score: number; signals: TrendingSignal }[]> {
  const db = getAdminDb();
  const weights = getTrendingWeights();
  const hours = windowHours ?? weights.windowHours;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  // Candidate pool: any agent with recent signal rows.
  const { data: hires } = await db.from("hires").select("agent_id, created_at").gte("created_at", since);
  const { data: activity } = await db.from("activity").select("agent_id, type, created_at").gte("created_at", since);
  const { data: views } = await db.from("agent_views").select("agent_id, viewed_at").gte("viewed_at", since);

  const candidateIds = new Set<string>();
  for (const h of hires ?? []) if (h.agent_id) candidateIds.add(h.agent_id);
  for (const a of activity ?? []) if (a.agent_id) candidateIds.add(a.agent_id);
  for (const v of views ?? []) if (v.agent_id) candidateIds.add(v.agent_id);

  const map = new Map<string, TrendingSignal>();
  for (const id of candidateIds) {
    map.set(id, {
      agentId: id, hires: { count: 0, weighted: 0 }, tasks: { count: 0, weighted: 0 },
      views: { count: 0, weighted: 0 }, executions: { count: 0, weighted: 0 },
      activity: { count: 0, weighted: 0 }, score: 0,
    });
  }
  for (const h of hires ?? []) {
    const s = map.get(h.agent_id);
    if (s) { s.hires.count += 1; s.hires.weighted += decay(h.created_at, hours); }
  }
  for (const a of activity ?? []) {
    const s = map.get(a.agent_id);
    if (!s) continue;
    if (a.type === "task_completed" || a.type === "task_failed") { s.tasks.count += 1; s.tasks.weighted += decay(a.created_at, hours); }
    else { s.activity.count += 1; s.activity.weighted += decay(a.created_at, hours); }
  }
  for (const v of views ?? []) {
    const s = map.get(v.agent_id);
    if (s) { s.views.count += 1; s.views.weighted += decay(v.viewed_at, hours); }
  }
  for (const s of map.values()) {
    s.score = computeScore(
      {
        recentHires: s.hires.weighted, recentTasks: s.tasks.weighted, recentViews: s.views.weighted,
        recentExecutions: s.executions.weighted, recentActivity: s.activity.weighted,
      },
      weights,
    );
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ agentId: s.agentId, score: s.score, signals: s }));
}
