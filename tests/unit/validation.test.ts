import { describe, expect, it } from "vitest";
import { parseAmount, requireAddress, requireChainId, requireHex, requireTask } from "../../lib/validation";

describe("address validation", () => {
  it("accepts valid addresses", () => {
    expect(requireAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  });
  it("rejects invalid addresses", () => {
    expect(() => requireAddress("not-an-address")).toThrow();
    expect(() => requireAddress("0x123")).toThrow();
    expect(() => requireAddress(42)).toThrow();
  });
});

describe("hex validation", () => {
  it("accepts valid hex", () => {
    expect(requireHex("0x1234abcd")).toBe("0x1234abcd");
  });
  it("rejects non-hex", () => {
    expect(() => requireHex("1234")).toThrow();
    expect(() => requireHex("xyz")).toThrow();
  });
});

describe("chain id validation", () => {
  it("accepts supported chains", () => {
    expect(requireChainId("97", [56, 97])).toBe(97);
    expect(requireChainId(56, [56, 97])).toBe(56);
  });
  it("rejects unsupported chains", () => {
    expect(() => requireChainId(1, [56, 97])).toThrow();
    expect(() => requireChainId("x", [56, 97])).toThrow();
  });
});

describe("amount validation", () => {
  it("parses decimal amounts into raw units", () => {
    expect(parseAmount("1.5", 18)).toBe("1500000000000000000");
    expect(parseAmount("0.000001", 18)).toBe("1000000000000");
    expect(parseAmount("10", 6)).toBe("10000000");
  });
  it("rejects malformed amounts", () => {
    expect(() => parseAmount("-1", 18)).toThrow();
    expect(() => parseAmount("1.2345678", 6)).toThrow(); // too many decimals
    expect(() => parseAmount("abc", 18)).toThrow();
    expect(() => parseAmount("0", 18)).toThrow(); // must be > 0
  });
});

describe("task validation", () => {
  it("accepts a valid task", () => {
    expect(requireTask("Monitor my wallet and alert on large transfers.")).toBeTruthy();
  });
  it("rejects too-short or too-long tasks", () => {
    expect(() => requireTask("short")).toThrow();
    expect(() => requireTask("x".repeat(2001))).toThrow();
  });
});
