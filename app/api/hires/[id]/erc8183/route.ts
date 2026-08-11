import { handle, ok } from "@/lib/api/response";
import { erc8183Hire } from "@/lib/services/hires";
import { requireAuth } from "@/lib/auth/session";
import { z } from "zod";
import { parseBody } from "@/lib/api/response";

/**
 * POST /api/hires/[id]/erc8183
 * Fund a prepared hire through the ERC-8183 commerce escrow (requires a
 * configured Altana operator wallet). Body: { txId }
 */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/hires/[id]/erc8183">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const body = await parseBody(request, z.object({ txId: z.string() }));
  const result = await erc8183Hire({ hireId: id, txId: body.txId, userWallet: auth.wallet });
  return ok(result);
});
