import { z } from "zod";
import { createAuthNonce } from "@/lib/auth/nonce";
import { buildAuthMessage } from "@/lib/auth/crypto";
import { handle, ok, parseBody } from "@/lib/api/response";
import { requireAddress } from "@/lib/validation";
import { publicEnv } from "@/lib/env";

/**
 * POST /api/auth/nonce
 * Request a single-use nonce for wallet authentication.
 * Body: { walletAddress }
 */
export const POST = handle(async (request: Request) => {
  const body = await parseBody(
    request,
    z.object({ walletAddress: z.string() }),
  );
  const wallet = requireAddress(body.walletAddress, "walletAddress");
  const nonceRecord = await createAuthNonce(wallet);
  return ok({
    nonce: nonceRecord.nonce,
    message: buildAuthMessage(nonceRecord.nonce),
    expiresAt: nonceRecord.expires_at,
    chainId: publicEnv.NEXT_PUBLIC_CHAIN_ID,
  });
});
