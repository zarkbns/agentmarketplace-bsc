import { requireAuth } from "@/lib/auth/session";
import { handle, ok } from "@/lib/api/response";
import { getAdminDb } from "@/lib/db";
import { getAgentById } from "@/lib/services/agents";

/** GET /api/hires/[id] — a single hire (owner only). */
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/hires/[id]">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const db = getAdminDb();
  const { data, error } = await db
    .from("hires")
    .select("*")
    .eq("id", id)
    .eq("user_wallet", auth.wallet.toLowerCase())
    .single();
  if (error || !data) {
    return ok(null, { error: "HIRE_NOT_FOUND" }, 404);
  }
  const agent = await getAgentById(data.agent_id).catch(() => null);
  return ok({ hire: data, agent });
});
