import { z } from "zod";
import { handle, ok, parseQuery } from "@/lib/api/response";
import { getRecentActivity } from "@/lib/services/activity";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  type: z.string().optional(),
});

/** GET /api/activity — recent marketplace activity feed. */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(new URL(request.url), querySchema);
  const activity = await getRecentActivity(query.limit);
  const filtered = query.type ? activity.filter((a) => a.type === query.type) : activity;
  return ok(filtered);
});
