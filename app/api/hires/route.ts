import { z } from "zod";
import { handle, ok, parseBody } from "@/lib/api/response";
import { prepareHire, getUserHires } from "@/lib/services/hires";
import { requireAuth } from "@/lib/auth/session";
import { requireAddress } from "@/lib/validation";

const prepareSchema = z.object({
  agentId: z.string().min(1),
  task: z.string().min(10).max(2000),
  rail: z.enum(["native", "erc8183"]).default("native"),
});

/** POST /api/hires — prepare a hire (creates the hire + transaction intent). */
export const POST = handle(async (request: Request) => {
  const auth = await requireAuth();
  const body = await parseBody(request, prepareSchema);
  const wallet = requireAddress(auth.wallet, "wallet");
  const prepared = await prepareHire(
    { agentId: body.agentId, task: body.task, rail: body.rail },
    wallet,
  );
  return ok(prepared, {}, 201);
});

/** GET /api/hires — the signed-in user's hires. */
export const GET = handle(async () => {
  const auth = await requireAuth();
  const hires = await getUserHires(auth.wallet);
  return ok(hires);
});
