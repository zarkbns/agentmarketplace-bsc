import { serverEnv } from "../env";
import { AppError } from "../errors";
import { logger } from "../logger";

/**
 * PaymentAdapter — interface for agent-to-agent payments (x402 / B402).
 *
 * x402 is the HTTP payment standard: an agent requests a resource, the
 * provider replies with a 402 + payment requirement, the payer signs and
 * submits a payment, and the provider returns the resource.
 *
 * This adapter is the seam for that flow. The actual payment execution is
 * implemented by the Altana SDK (fetchWithX402 / signX402Payment /
 * approveTokenForPermit2 — session-key payments gated by Permit2). Full
 * agent-to-agent orchestration is documented in docs/architecture.md and
 * is NOT implemented end-to-end yet.
 */

export interface PaymentRequirement {
  type: "x402";
  chainId: number;
  amount: string;
  token: string;
  recipient: string;
  payeeEndpoint: string;
}

export interface PaymentResult {
  paid: boolean;
  resourceUrl?: string;
  paymentTx?: string;
  method: "x402";
}

export interface PaymentAdapter {
  /** Request a resource, paying the x402 requirement if present. */
  requestResource(
    url: string,
    opts: { maxPayment: string; token: string },
  ): Promise<PaymentResult>;
  /** Check whether the adapter is configured and can actually pay. */
  isAvailable(): boolean;
}

/**
 * x402 adapter backed by the Altana SDK session payer.
 * Requires a live Altana Session (see lib/adapters/altana.ts).
 * When no session is available this adapter is unavailable and callers must
 * fall back to explicit user-approved transactions.
 */
export class X402PaymentAdapter implements PaymentAdapter {
  constructor(private readonly session: { payWithX402: (url: string, opts: { maxPayment: string }) => Promise<Response> } | null) {}

  isAvailable(): boolean {
    return this.session !== null;
  }

  async requestResource(url: string, opts: { maxPayment: string; token: string }): Promise<PaymentResult> {
    if (!this.session) {
      throw new AppError("PAYMENT_UNAVAILABLE", "x402 payments are unavailable: no active session.", 503);
    }
    try {
      const res = await this.session.payWithX402(url, { maxPayment: opts.maxPayment });
      await res.text();
      return {
        paid: true,
        resourceUrl: url,
        method: "x402",
      };
    } catch (err) {
      logger.warn({ err, url }, "x402 payment failed");
      throw new AppError("PAYMENT_FAILED", "The x402 payment failed.", 502);
    }
  }
}

/** Environment note: which chain/rail configuration applies. */
export function paymentRailInfo(): { rail: "x402"; chainId: number; enabled: boolean } {
  const env = serverEnv();
  const chainId = env.ALTANA_NETWORK === "bnb-testnet" ? 97 : 56;
  return { rail: "x402", chainId, enabled: Boolean(env.ALTANA_ADMIN_PRIVATE_KEY) };
}
