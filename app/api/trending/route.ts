import { z } from "zod";
import { handle, ok, parseQuery } from "@/lib/api/response";
import { getTrendingAgents } from "@/lib/services/trending";
import { getAgentById } from "@/lib/services/agents";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
  windowHours: z.coerce.number().int().min(1).max(24 * 30).optional(),
});

/** GET /api/trending — top agents by the configurable trending score. */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(new URL(request.url), querySchema);
  const trending = await getTrendingAgents(query.limit, query.windowHours);
  const agents = [];
  for (const t of trending) {
    try {
      const agent = await getAgentById(t.agentId);
      agents.push({
        agent,
        trendingScore: Math.round(t.score * 100) / 100,
        signals: {
          recentHires: Math.round(t.signals.hires.weighted * 100) / 100,
          recentTasks: Math.round(t.signals.tasks.weighted * 100) / 100,
          recentViews: Math.round(t.signals.views.weighted * 100) / 100,
          recentActivity: Math.round(t.signals.activity.weighted * 100) / 100,
        },
      });
    } catch {
      // agent may have been removed since scoring
    }
  }
  return ok(agents, { formula: "w_hires*hires + w_tasks*tasks + w_views*views + w_executions*executions + w_activity*activity (time-decayed)" });
});
