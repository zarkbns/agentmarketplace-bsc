import type { TxState } from "../types";

/**
 * Transaction lifecycle — the single state machine for every marketplace
 * transaction. Never assume a submitted transaction succeeded: SUBMITTED →
 * PENDING → CONFIRMED only advances from on-chain confirmation.
 *
 *   CREATED → AWAITING_SIGNATURE → SUBMITTED → PENDING → CONFIRMED
 *                                        │        └─→ FAILED
 *                                        └─→ REJECTED / CANCELLED
 *   (any pre-submission state) → EXPIRED
 */

export const TERMINAL_STATES: ReadonlySet<TxState> = new Set([
  "confirmed",
  "failed",
  "rejected",
  "expired",
  "cancelled",
]);

const ALLOWED_TRANSITIONS: Record<TxState, ReadonlySet<TxState>> = {
  created: new Set(["awaiting_signature", "cancelled", "expired"]),
  awaiting_signature: new Set(["submitted", "rejected", "expired", "cancelled"]),
  submitted: new Set(["pending", "failed", "rejected"]),
  pending: new Set(["confirmed", "failed"]),
  confirmed: new Set(),
  rejected: new Set(["submitted"]), // user may retry after rejecting
  failed: new Set(["submitted"]), // retry after on-chain failure
  expired: new Set(),
  cancelled: new Set(),
};

export class InvalidTransitionError extends Error {
  constructor(public readonly from: TxState, public readonly to: TxState) {
    super(`Invalid transaction state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Pure: can a transaction move from `from` to `to`? */
export function canTransition(from: TxState, to: TxState): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** Pure: assert the transition, throwing InvalidTransitionError. */
export function assertTransition(from: TxState, to: TxState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Pure: next expected state after a user signs a prepared transaction. */
export function nextStateAfterSignature(current: TxState): TxState {
  if (current === "awaiting_signature") return "submitted";
  throw new InvalidTransitionError(current, "submitted");
}

/** Human-readable status label for the UI. */
export const TX_STATE_LABELS: Record<TxState, string> = {
  created: "Preparing",
  awaiting_signature: "Awaiting your signature",
  submitted: "Broadcast",
  pending: "Pending confirmation",
  confirmed: "Confirmed on-chain",
  rejected: "Signature rejected",
  failed: "Failed on-chain",
  expired: "Expired",
  cancelled: "Cancelled",
};
