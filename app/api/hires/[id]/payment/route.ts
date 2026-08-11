import { z } from "zod";
import { handle, ok, parseBody } from "@/lib/api/response";
import { submitNativePayment, refreshHireConfirmation } from "@/lib/services/hires";
import { requireAuth } from "@/lib/auth/session";
import { requireHex } from "@/lib/validation";

/**
 * POST /api/hires/[id]/payment
 * Body (native rail): { txId, txHash }
 *   Records the user's signed + broadcast native payment. Confirmation is
 *   verified on-chain (see /refresh).
 */
export const POST = handle(async (request: Request, ctx: RouteContext<"/api/hires/[id]/payment">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const body = await parseBody(request, z.object({ txId: z.string(), txHash: z.string() }));
  const txHash = requireHex(body.txHash, "txHash");
  const result = await submitNativePayment({ hireId: id, txId: body.txId, txHash, userWallet: auth.wallet });
  return ok(result);
});

/**
 * GET /api/hires/[id]/payment — refresh confirmation state from the chain.
 * Never reports success before an on-chain CONFIRMED receipt.
 */
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/hires/[id]/payment">) => {
  const { id } = await ctx.params;
  const auth = await requireAuth();
  const result = await refreshHireConfirmation({ hireId: id, userWallet: auth.wallet });
  return ok(result);
});
