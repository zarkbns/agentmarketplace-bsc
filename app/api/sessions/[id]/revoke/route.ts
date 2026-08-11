import { handle, ok } from "@/lib/api/response";
import { revokeSession } from "@/lib/services/sessions";
import { requireAuth } from "@/lib/auth/session";

/** POST /api/sessions/[id]/revoke — REAL on-chain revocation, then re-read authoritative state. */
export const POST = handle(async (_request: Request, ctx: RouteContext<"/api/sessions/[id]/revoke">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const result = await revokeSession(id, auth.wallet);
  return ok(result);
});
