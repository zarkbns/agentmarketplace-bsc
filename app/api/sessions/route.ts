import { z } from "zod";
import { getAddress } from "viem";
import { handle, ok, parseBody } from "@/lib/api/response";
import { createAgentSession, getUserSessions } from "@/lib/services/sessions";
import { requireAuth } from "@/lib/auth/session";
import { requireAddress } from "@/lib/validation";

const createSchema = z.object({
  agentId: z.string().min(1),
  spendCap: z.string().regex(/^\d+$/, "spendCap must be an integer amount in raw token units"),
  spendToken: z.string().default("0x0000000000000000000000000000000000000000"),
  period: z.enum(["minute", "hour", "day", "week", "month", "year"]).default("day"),
  expiryHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  allowedCalls: z.array(
    z.object({
      to: z.string().optional(),
      signature: z.string().optional(),
    }),
  ).default([]),
});

/** POST /api/sessions — grant a scoped Altana session (on-chain). */
export const POST = handle(async (request: Request) => {
  const auth = await requireAuth();
  const body = await parseBody(request, createSchema);
  const spendToken = requireAddress(body.spendToken, "spendToken");
  for (const call of body.allowedCalls) {
    if (call.to) requireAddress(call.to, "allowedCalls[].to");
  }
  const result = await createAgentSession({
    userWallet: auth.wallet,
    agentId: body.agentId,
    spendCap: body.spendCap,
    spendToken,
    allowedCalls: body.allowedCalls.map((c) => ({ to: c.to ? getAddress(c.to) : undefined, signature: c.signature })),
    expiryHours: body.expiryHours,
    period: body.period,
  });
  return ok(result, {}, 201);
});

/** GET /api/sessions — the user's sessions (cached view; on-chain is authoritative). */
export const GET = handle(async () => {
  const auth = await requireAuth();
  const sessions = await getUserSessions(auth.wallet);
  return ok(sessions);
});
