import { getAgentsByOwner } from "@/lib/services/agents";
import { requireAuth } from "@/lib/auth/session";
import { handle, ok } from "@/lib/api/response";

/** GET /api/agents/mine — agents owned by the signed-in wallet. */
export const GET = handle(async () => {
  const auth = await requireAuth();
  const agents = await getAgentsByOwner(auth.wallet);
  return ok(agents);
});
