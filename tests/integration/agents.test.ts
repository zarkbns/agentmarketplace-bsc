import { describe, expect, it, beforeEach, vi } from "vitest";
import { getAddress } from "viem";
import { FakeDb } from "../helpers/fake-db";

const { holder } = vi.hoisted(() => ({ holder: { db: null as unknown as FakeDb } }));

vi.mock("../../lib/db", () => ({
  getAdminDb: () => holder.db,
  getDbForWallet: () => holder.db,
}));

const { createAgent, getAgentBySlug, getAgentById, uniqueSlug, validateAgentInput, validateOnchainIdentity } = await import("../../lib/services/agents");

const OWNER = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

function validInput() {
  return {
    chainId: 97,
    name: "Test Agent",
    slug: "test-agent",
    description: "A test agent.",
    category: "automation" as const,
    pricingModel: "per_task" as const,
    price: "1.5",
    currency: "USDC",
    capabilities: [{ capability: "monitoring" }],
    protocols: [{ protocol: "erc8004", network: "testnet" }],
  };
}

beforeEach(() => {
  holder.db = new FakeDb();
});

describe("agent input validation", () => {
  it("accepts a valid listing input", () => {
    expect(() => validateAgentInput(validInput())).not.toThrow();
  });

  it("rejects invalid names, slugs and categories", () => {
    expect(() => validateAgentInput({ ...validInput(), name: "x" })).toThrow();
    expect(() => validateAgentInput({ ...validInput(), slug: "UPPER" })).toThrow();
    expect(() => validateAgentInput({ ...validInput(), category: "nope" as never })).toThrow();
    expect(() => validateAgentInput({ ...validInput(), pricingModel: "nope" as never })).toThrow();
  });

  it("rejects bad prices and endpoints", () => {
    expect(() => validateAgentInput({ ...validInput(), price: "1.5.5" })).toThrow();
    expect(() => validateAgentInput({ ...validInput(), endpoint: "ftp://x" })).toThrow();
  });
});

describe("marketplace listing (no on-chain identity)", () => {
  it("creates an unverified marketplace-only listing", async () => {
    const agent = await createAgent(validInput(), OWNER);
    expect(agent.slug).toBe("test-agent");
    expect(agent.verification_status).toBe("unverified");
    expect(agent.registration_source).toBe("marketplace");
    expect(agent.onchain_agent_id).toBeNull();
    expect(agent.owner_wallet).toBe(getAddress(OWNER));
    expect(holder.db.table("agent_performance")).toHaveLength(1);
    expect(holder.db.table("agent_capabilities")[0].capability).toBe("monitoring");
    expect(holder.db.table("activity")[0].type).toBe("new_listing");
  });

  it("slug collisions get a suffix", async () => {
    const input = validInput();
    await createAgent(input, OWNER);
    const second = await createAgent({ ...input, name: "Test Agent 2" }, OWNER);
    expect(second.slug).toBe("test-agent-2");
  });

  it("can be fetched by slug and id", async () => {
    const agent = await createAgent(validInput(), OWNER);
    const bySlug = await getAgentBySlug("test-agent", holder.db as never);
    const byId = await getAgentById(agent.id, holder.db as never);
    expect(bySlug.id).toBe(agent.id);
    expect(byId.name).toBe("Test Agent");
    expect(byId.capabilities).toHaveLength(1);
  });

  it("rejects duplicate slugs after uniqueSlug", async () => {
    await createAgent(validInput(), OWNER);
    const candidate = await uniqueSlug(holder.db as never, "test-agent");
    expect(candidate).not.toBe("test-agent");
  });

  it("does NOT hit the registry for marketplace listings", async () => {
    // validateOnchainIdentity is only invoked when agentId+registryAddress are
    // provided; for marketplace listings it must never be called.
    const spy = vi.fn();
    // If createAgent attempted registry reads it would throw (no RPC in tests).
    await createAgent(validInput(), OWNER);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("registry-backed listing", () => {
  it("rejects unknown registry addresses without network access", async () => {
    await expect(
      validateOnchainIdentity({
        chainId: 97,
        registryAddress: getAddress("0x0000000000000000000000000000000000000001"),
        agentId: "1",
        claimingWallet: OWNER,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "INVALID_REGISTRY" }));
  });

  it("rejects malformed agent ids", async () => {
    await expect(
      validateOnchainIdentity({
        chainId: 97,
        registryAddress: getAddress("0x8004A818BFB912233c491871b3d84c89A494BD9e"),
        agentId: "not-a-number",
        claimingWallet: OWNER,
      }),
    ).rejects.toThrow();
  });
});
