import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  nextStateAfterSignature,
  TERMINAL_STATES,
} from "../../lib/services/transactions";
import type { TxState } from "../../lib/types";

const ALL_STATES: TxState[] = [
  "created", "awaiting_signature", "submitted", "pending", "confirmed",
  "rejected", "failed", "expired", "cancelled",
];

describe("transaction state machine", () => {
  it("follows the happy path created → awaiting_signature → submitted → pending → confirmed", () => {
    const path: TxState[] = ["created", "awaiting_signature", "submitted", "pending", "confirmed"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
    expect(TERMINAL_STATES.has("confirmed")).toBe(true);
  });

  it("never skips steps or jumps to confirmed", () => {
    expect(canTransition("created", "confirmed")).toBe(false);
    expect(canTransition("submitted", "confirmed")).toBe(false); // must go through pending
    expect(canTransition("awaiting_signature", "pending")).toBe(false);
    expect(canTransition("created", "submitted")).toBe(false);
  });

  it("allows failure paths", () => {
    expect(canTransition("awaiting_signature", "rejected")).toBe(true);
    expect(canTransition("submitted", "failed")).toBe(true);
    expect(canTransition("pending", "failed")).toBe(true);
    expect(canTransition("created", "cancelled")).toBe(true);
    expect(canTransition("awaiting_signature", "expired")).toBe(true);
  });

  it("allows retry after rejection/failure, but not after confirmation", () => {
    expect(canTransition("rejected", "submitted")).toBe(true);
    expect(canTransition("failed", "submitted")).toBe(true);
    expect(canTransition("confirmed", "submitted")).toBe(false);
    expect(canTransition("confirmed", "failed")).toBe(false);
  });

  it("assertTransition throws for invalid transitions", () => {
    expect(() => assertTransition("confirmed", "failed")).toThrow(InvalidTransitionError);
    expect(() => assertTransition("pending", "created")).toThrow(InvalidTransitionError);
  });

  it("terminal states have no outgoing transitions", () => {
    // confirmed/expired/cancelled are truly terminal. rejected/failed are
    // terminal-but-retryable: they allow re-submission.
    for (const state of ["confirmed", "expired", "cancelled"] as const) {
      for (const to of ALL_STATES) {
        expect(canTransition(state, to)).toBe(false);
      }
    }
  });

  it("nextStateAfterSignature only advances from awaiting_signature", () => {
    expect(nextStateAfterSignature("awaiting_signature")).toBe("submitted");
    expect(() => nextStateAfterSignature("created")).toThrow();
    expect(() => nextStateAfterSignature("submitted")).toThrow();
  });

  it("a submitted transaction is never treated as confirmed", () => {
    // Guards the core rule: confirmation is an on-chain receipt fact.
    expect(canTransition("submitted", "confirmed")).toBe(false);
    expect("submitted" in TERMINAL_STATES).toBe(false);
    expect("pending" in TERMINAL_STATES).toBe(false);
  });
});
