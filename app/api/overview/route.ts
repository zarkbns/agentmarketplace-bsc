import { z } from "zod";
import { handle, ok, parseQuery } from "@/lib/api/response";
import { getOverviewStats, windowToMs } from "@/lib/services/overview";
import { getAdminDb } from "@/lib/db";

const querySchema = z.object({
  window: z.enum(["15m", "30m", "1h", "24h", "7d"]).default("24h"),
});

/** GET /api/overview — ecosystem intelligence, computed from real records. */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(new URL(request.url), querySchema);
  const stats = await getOverviewStats();
  const windowMs = windowToMs(query.window);
  const since = new Date(Date.now() - windowMs).toISOString();

  const db = getAdminDb();
  const [hiresInWindow, tasksInWindow, newAgentsInWindow] = await Promise.all([
    db.from("hires").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("activity").select("id", { count: "exact", head: true }).eq("type", "task_completed").gte("created_at", since),
    db.from("agents").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);

  return ok({
    ...stats,
    window: query.window,
    windowStats: {
      hires: hiresInWindow.count ?? 0,
      tasksCompleted: tasksInWindow.count ?? 0,
      newAgents: newAgentsInWindow.count ?? 0,
    },
  });
});
