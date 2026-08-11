import { z } from "zod";
import { consumeAuthNonce } from "@/lib/auth/nonce";
import { verifyAuthSignature } from "@/lib/auth/crypto";
import { createAuthSession, getAuthUser } from "@/lib/auth/session";
import { handle, ok, parseBody } from "@/lib/api/response";
import { AppError } from "@/lib/errors";
import { requireAddress } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { publicEnv } from "@/lib/env";

/**
 * POST /api/auth/verify
 * Verify a signed authentication message and create a session.
 * Body: { walletAddress, message, signature }
 *
 * The wallet address is never trusted from the client: it is derived from
 * the recovered signer of the signature.
 */
export const POST = handle(async (request: Request) => {
  const body = await parseBody(
    request,
    z.object({
      walletAddress: z.string(),
      message: z.string(),
      signature: z.string(),
    }),
  );
  const wallet = requireAddress(body.walletAddress, "walletAddress");

  // 1. Consume the nonce (single-use, replay protection).
  const nonceMatch = body.message.match(/Nonce: ([0-9a-f]{64})$/);
  if (!nonceMatch) {
    throw new AppError("INVALID_NONCE", "Message does not contain a valid nonce.", 401);
  }
  await consumeAuthNonce(nonceMatch[1], wallet);

  // 2. Verify the signature (EIP-191). The recovered signer must equal the
  //    claimed wallet.
  const verified = await verifyAuthSignature({
    message: body.message,
    signature: body.signature,
    expectedAddress: wallet,
  });
  if (!verified) {
    logger.warn({ wallet }, "signature verification failed");
    throw new AppError("INVALID_SIGNATURE", "The signature does not match this wallet address.", 401);
  }

  // 3. Upsert the user profile and create the session cookie.
  const user = await getAuthUser(wallet, publicEnv.NEXT_PUBLIC_CHAIN_ID);
  await createAuthSession(wallet);
  logger.info({ wallet }, "user authenticated");

  return ok({
    user: {
      walletAddress: user.wallet_address,
      chainId: user.chain_id,
      avatarSeed: user.avatar_seed,
      displayName: user.display_name,
    },
  });
});
