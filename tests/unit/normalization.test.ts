import { describe, expect, it } from "vitest";
import { ERC8004Adapter } from "../../lib/adapters/erc8004";
import { AppError } from "../../lib/errors";

// The normalizer is pure; construct the adapter without touching chains.
const adapter = new ERC8004Adapter(97);

describe("ERC-8004 registration file normalization", () => {
  it("normalizes a canonical registration file", () => {
    const raw = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "YieldGuard",
      description: "Monitors yields.",
      image: "https://example.com/avatar.png",
      services: [
        { name: "MCP", endpoint: "https://mcp.example.com/", version: "2025-06-18" },
        { name: "A2A", endpoint: "https://agent.example/.well-known/agent-card.json", version: "0.3.0" },
      ],
      x402Support: true,
      active: true,
      registrations: [{ agentId: 42, agentRegistry: "eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e" }],
      supportedTrust: ["reputation"],
      extraUnknownField: "preserved only on raw",
    };
    const normalized = adapter.normalizeRegistrationFile(raw);
    expect(normalized.name).toBe("YieldGuard");
    expect(normalized.services).toHaveLength(2);
    expect(normalized.x402Support).toBe(true);
    expect(normalized.registrations?.[0].agentId).toBe(42);
    expect("extraUnknownField" in normalized).toBe(false);
  });

  it("tolerates missing optional fields", () => {
    const normalized = adapter.normalizeRegistrationFile({ name: "Minimal" });
    expect(normalized.name).toBe("Minimal");
    expect(normalized.services).toBeUndefined();
    expect(normalized.x402Support).toBeUndefined();
  });

  it("rejects non-object payloads", () => {
    expect(() => adapter.normalizeRegistrationFile("not json")).toThrow(AppError);
    expect(() => adapter.normalizeRegistrationFile(null)).toThrow(AppError);
    // Arrays are technically objects; they pass through and normalize to an
    // empty record rather than being silently dropped or failing.
    expect(() => adapter.normalizeRegistrationFile([1, 2])).not.toThrow();
  });

  it("rejects non-string service endpoints rather than fabricating them", () => {
    const normalized = adapter.normalizeRegistrationFile({
      name: "X",
      services: [{ name: "web", endpoint: 42 }],
    });
    expect(normalized.services?.[0].endpoint).toBeUndefined();
  });
});
