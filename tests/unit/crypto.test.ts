import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildAuthMessage,
  generateNonce,
  generateSessionToken,
  hashSessionToken,
  verifyAuthSignature,
} from "../../lib/auth/crypto";

// Fixed test key (public test vector, never used in production).
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("auth crypto", () => {
  const account = privateKeyToAccount(TEST_KEY);

  it("generates unique, format-valid nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds a message embedding the nonce", () => {
    const msg = buildAuthMessage("abc123");
    expect(msg).toContain("AgentGrid");
    expect(msg).toContain("Nonce: abc123");
  });

  it("verifies a valid EIP-191 signature and recovers the signer", async () => {
    const message = buildAuthMessage(generateNonce());
    const signature = await account.signMessage({ message });
    const verified = await verifyAuthSignature({
      message,
      signature,
      expectedAddress: account.address,
    });
    expect(verified).toBe(true);
  });

  it("rejects a signature from a different wallet", async () => {
    const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const message = buildAuthMessage(generateNonce());
    const signature = await account.signMessage({ message });
    const verified = await verifyAuthSignature({ message, signature, expectedAddress: other.address });
    expect(verified).toBe(false);
  });

  it("rejects a tampered message", async () => {
    const message = buildAuthMessage(generateNonce());
    const signature = await account.signMessage({ message });
    const verified = await verifyAuthSignature({ message: message + " ", signature, expectedAddress: account.address });
    expect(verified).toBe(false);
  });

  it("session tokens are opaque and hashed before storage", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(token).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hash); // deterministic
  });
});
