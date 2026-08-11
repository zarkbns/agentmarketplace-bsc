import { z } from "zod";
import { handle, ok, parseBody } from "@/lib/api/response";
import { cancelHire } from "@/lib/services/hires";
import { requireAuth } from "@/lib/auth/session";

/** POST /api/hires/[id]/cancel — cancel or reject a hire (owner only). */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/hires/[id]/cancel">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const body = await parseBody(request, z.object({ state: z.enum(["cancelled", "rejected"]) }));
  await cancelHire({ hireId: id, userWallet: auth.wallet, state: body.state });
  return ok({ cancelled: true });
});
