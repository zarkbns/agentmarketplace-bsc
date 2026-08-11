import { describe, expect, it, beforeEach, vi } from "vitest";
import { getAddress } from "viem";
import { FakeDb } from "../helpers/fake-db";

const { holder } = vi.hoisted(() => ({ holder: { db: null as unknown as FakeDb } }));

vi.mock("../../lib/db", () => ({
  getAdminDb: () => holder.db,
  getDbForWallet: () => holder.db,
}));

const { prepareHire, cancelHire, getUserHires, submitNativePayment } = await import("../../lib/services/hires");
const { createAgent } = await import("../../lib/services/agents");
const { assertTransition } = await import("../../lib/services/transactions");

const USER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

async function seedAgent() {
  const agent = await createAgent(
    {
      chainId: 97,
      name: "Payout Agent",
      slug: "payout-agent",
      description: "Sends payments on schedule.",
      category: "automation",
      pricingModel: "per_task",
      price: "2",
      currency: "USDC",
      capabilities: [],
      protocols: [],
    },
    USER,
  );
  return agent;
}

beforeEach(() => {
  holder.db = new FakeDb();
});

describe("hire lifecycle", () => {
  it("prepares a hire and its transaction intent", async () => {
    const agent = await seedAgent();
    const prepared = await prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, USER);

    expect(prepared.hire.status).toBe("awaiting_signature");
    expect(prepared.tx?.state).toBe("awaiting_signature");
    expect(prepared.tx?.amount).toBe("2");
    expect(prepared.rail).toBe("native");
    expect(holder.db.table("transactions")).toHaveLength(1);
    expect(holder.db.table("transactions")[0].kind).toBe("payment");
  });

  it("rejects hires for unavailable agents", async () => {
    const agent = await seedAgent();
    await holder.db.from("agents").update({ status: "paused" }).eq("id", agent.id);
    await expect(
      prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, USER),
    ).rejects.toThrowError(expect.objectContaining({ code: "AGENT_UNAVAILABLE" }));
  });

  it("rejects short tasks", async () => {
    const agent = await seedAgent();
    await expect(
      prepareHire({ agentId: agent.id, task: "short", rail: "native" }, USER),
    ).rejects.toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("moves a hire to funding after submitting a tx hash", async () => {
    const agent = await seedAgent();
    const prepared = await prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, USER);
    const tx = prepared.tx!;

    const result = await submitNativePayment({ hireId: prepared.hire.id, txId: tx.id, txHash: `0x${"ab".repeat(32)}`, userWallet: USER });
    expect(result.state).toBe("submitted");
    expect(result.hireStatus).toBe("funding");

    const stored = holder.db.table("transactions")[0];
    expect(stored.state).toBe("submitted");
    expect(stored.tx_hash).toBe(`0x${"ab".repeat(32)}`);
    expect(assertTransition("submitted", "pending")).toBeUndefined();
  });

  it("rejects submitting a tx for a foreign hire", async () => {
    const agent = await seedAgent();
    const other = getAddress("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
    const prepared = await prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, other);
    await expect(
      submitNativePayment({ hireId: prepared.hire.id, txId: prepared.tx!.id, txHash: `0x${"cd".repeat(32)}`, userWallet: USER }),
    ).rejects.toThrowError(expect.objectContaining({ code: "TRANSACTION_NOT_FOUND" }));
  });

  it("cancels a hire", async () => {
    const agent = await seedAgent();
    const prepared = await prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, USER);
    await cancelHire({ hireId: prepared.hire.id, userWallet: USER, state: "cancelled" });
    expect(holder.db.table("hires")[0].status).toBe("cancelled");
    expect(holder.db.table("transactions")[0].state).toBe("cancelled");
  });

  it("lists only the user's hires", async () => {
    const agent = await seedAgent();
    const other = getAddress("0x14dC79964da2C08b23698B3D3cc7Ca32193d9955");
    await prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, USER);
    await prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, other);

    const mine = await getUserHires(USER);
    expect(mine).toHaveLength(1);
    expect(mine[0].user_wallet).toBe(USER.toLowerCase());
  });

  it("cannot be prepared for an agent with no valid price", async () => {
    const agent = await seedAgent();
    await holder.db.from("agents").update({ price: "0" }).eq("id", agent.id);
    await expect(
      prepareHire({ agentId: agent.id, task: "Send the monthly payout batch to all suppliers.", rail: "native" }, USER),
    ).rejects.toThrowError(expect.objectContaining({ code: "AGENT_UNAVAILABLE" }));
  });
});

describe("transaction state machine integration", () => {
  it("forbids confirming without an on-chain receipt", () => {
    // The service never calls assertTransition(..., "confirmed") — confirmed
    // only arrives from refreshHireConfirmation after reading a receipt.
    expect(() => assertTransition("submitted", "confirmed")).toThrow(/Invalid transaction state/);
  });
});
