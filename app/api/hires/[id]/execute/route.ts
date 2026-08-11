import { handle, ok } from "@/lib/api/response";
import { executeHire } from "@/lib/services/hires";
import { requireAuth } from "@/lib/auth/session";

/**
 * POST /api/hires/[id]/execute
 * Execute a funded hire: calls the agent's endpoint (or, in DEMO_MODE only,
 * a clearly-marked demo runner). Real executions update performance metrics.
 */
export const POST = handle(async (_request: Request, ctx: RouteContext<"/api/hires/[id]/execute">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const result = await executeHire({ hireId: id, userWallet: auth.wallet });
  return ok(result);
});
