import { handle, ok } from "@/lib/api/response";
import { refreshSessionState, getSessionSpendInfo } from "@/lib/services/sessions";
import { requireAuth } from "@/lib/auth/session";

/** POST /api/sessions/[id]/refresh — re-read the authoritative on-chain state. */
export const POST = handle(async (_request: Request, ctx: RouteContext<"/api/sessions/[id]/refresh">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const state = await refreshSessionState(id, auth.wallet);
  const spend = await getSessionSpendInfo(id, auth.wallet);
  return ok({ ...state, spend });
});
