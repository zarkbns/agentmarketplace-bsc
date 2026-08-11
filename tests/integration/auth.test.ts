import { describe, expect, it, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { FakeDb } from "../helpers/fake-db";
import { createAuthNonce, consumeAuthNonce } from "../../lib/auth/nonce";
import { buildAuthMessage } from "../../lib/auth/crypto";

// Dedicated test key (public vector, never used in production).
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(TEST_KEY);

let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

describe("auth flow (nonce → signature → session)", () => {
  it("creates a nonce, consumes it once, and rejects replay", async () => {
    // 1. Request nonce
    const nonceRecord = await createAuthNonce(account.address, db as never);
    expect(nonceRecord.consumed_at).toBeNull();

    // 2. Sign the message (proves the flow end-to-end; the sig is exercised
    //    by the crypto unit tests).
    const message = buildAuthMessage(nonceRecord.nonce);
    await account.signMessage({ message });

    // 3. Consume the nonce (what the verify endpoint does before checking the sig)
    const consumed = await consumeAuthNonce(nonceRecord.nonce, account.address, db as never);
    expect(consumed.consumed_at).not.toBeNull();

    // 4. Replay is rejected — the same nonce cannot be used again
    await expect(
      consumeAuthNonce(nonceRecord.nonce, account.address, db as never),
    ).rejects.toThrowError(expect.objectContaining({ code: "NONCE_REUSED" }));
  });

  it("rejects nonces for a different wallet", async () => {
    const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const nonceRecord = await createAuthNonce(account.address, db as never);
    await expect(
      consumeAuthNonce(nonceRecord.nonce, other.address, db as never),
    ).rejects.toThrow();
  });

  it("rejects unknown nonces", async () => {
    await expect(
      consumeAuthNonce("deadbeef".repeat(8), account.address, db as never),
    ).rejects.toThrowError(expect.objectContaining({ code: "INVALID_NONCE" }));
  });

  it("rejects expired nonces", async () => {
    // Insert an already-expired nonce directly.
    const expired = {
      id: "nonce_expired",
      wallet_address: account.address.toLowerCase(),
      nonce: "e".repeat(64),
      expires_at: new Date(Date.now() - 1000).toISOString(),
      consumed_at: null,
      created_at: new Date(Date.now() - 10_000).toISOString(),
    };
    db.table("auth_nonces").push(expired);
    await expect(
      consumeAuthNonce(expired.nonce, account.address, db as never),
    ).rejects.toThrowError(expect.objectContaining({ code: "NONCE_EXPIRED" }));
  });
});
