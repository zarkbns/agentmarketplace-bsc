import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress, verifyMessage as viemVerifyMessage } from "viem";

export const AUTH_MESSAGE_PREFIX = "AgentGrid authentication";

/**
 * Build the EIP-191 personal_sign message the user is asked to sign.
 * Includes the nonce, a purpose string and a timestamp for clarity.
 */
export function buildAuthMessage(nonce: string): string {
  return `${AUTH_MESSAGE_PREFIX}\n\nPlease sign this message to connect your wallet to AgentGrid.\n\nNonce: ${nonce}`;
}

export function generateNonce(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Verify an EIP-191 signature over `message` against the expected address.
 * Returns true when the recovered signer matches `expectedAddress` (after
 * checksum normalization), false otherwise. The wallet address is NEVER
 * trusted from the client — it is derived from the signature.
 */
export function verifyAuthSignature(params: {
  message: string;
  signature: string;
  expectedAddress: string;
}): Promise<boolean> {
  const { message, signature, expectedAddress } = params;
  return viemVerifyMessage({
    address: getAddress(expectedAddress),
    message,
    signature: signature as `0x${string}`,
  });
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** Opaque token id (stored in DB) derived from the session token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateUserAvatarSeed(wallet: string): string {
  return createHash("sha256").update(wallet).digest("hex").slice(0, 16);
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}
