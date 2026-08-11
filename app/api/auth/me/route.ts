import { getSessionWallet, revokeSession } from "@/lib/auth/session";
import { handle, ok } from "@/lib/api/response";

/** POST /api/auth/logout — revoke the server session AND clear the cookie. */
export const POST = handle(async () => {
  await revokeSession();
  return ok({ loggedOut: true });
});

/** GET /api/auth/me — current authenticated user (or null). */
export const GET = handle(async () => {
  const session = await getSessionWallet();
  if (!session) return ok({ user: null });
  const { getAuthUser } = await import("@/lib/auth/session");
  const user = await getAuthUser(session.wallet, session.chainId);
  return ok({
    user: {
      walletAddress: user.wallet_address,
      chainId: user.chain_id,
      avatarSeed: user.avatar_seed,
      displayName: user.display_name,
    },
  });
});
