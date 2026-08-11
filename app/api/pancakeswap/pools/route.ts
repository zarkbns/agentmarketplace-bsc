import { z } from "zod";
import { handle, ok, parseQuery } from "@/lib/api/response";
import { getPancakeSwapAdapter } from "@/lib/adapters/pancakeswap";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  orderBy: z.enum(["volumeUSD", "totalValueLockedUSD"]).default("totalValueLockedUSD"),
});

/** GET /api/pancakeswap/pools — top pools for liquidity intelligence. */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(new URL(request.url), querySchema);
  const adapter = getPancakeSwapAdapter();
  const result = await adapter.topPools({ limit: query.limit, orderBy: query.orderBy });
  return ok(result);
});
