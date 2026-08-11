import { handle, ok } from "@/lib/api/response";
import { requireAuth } from "@/lib/auth/session";
import { getAuthUser } from "@/lib/auth/session";

/** GET /api/users/me — the signed-in user's marketplace profile. */
export const GET = handle(async () => {
  const auth = await requireAuth();
  const user = await getAuthUser(auth.wallet, auth.chainId);
  return ok(user);
});
