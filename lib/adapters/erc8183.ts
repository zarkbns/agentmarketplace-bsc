import { hireErc8183Agent, getErc8183Job, getErc8183DeliverableUrl, settleErc8183Job, BNB, BNB_TESTNET, type Session, type NetworkConfig } from "@altananetwork/sdk";
import type { Address } from "viem";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { logger } from "../logger";

/**
 * ERC8183Adapter — buyer-side integration for hiring ERC-8183 agents.
 *
 * ERC-8183 (Agentic Commerce) is the BNB agent economy's job-escrow rail:
 * the buyer creates and funds a Job in $U on the AgenticCommerce kernel,
 * the seller submits a deliverable, and after the optimistic dispute window
 * `settle` releases the escrow.
 *
 * Implementation uses the official @altananetwork/sdk helpers
 * (hireErc8183Agent — five calls in one atomic relay intent). The marketplace
 * layer never touches these contracts directly.
 *
 * Status: real implementation (testnet-verified flow), gated on Altana being
 * configured. When Altana is not configured the marketplace falls back to
 * native-BNB payment rails.
 */

export interface Erc8183HireParams {
  provider: Address;
  task: string;
  budgetRawU: string; // $U has 18 decimals
  deadlineSeconds?: number;
}

export interface Erc8183HireResult {
  jobId: string;
  provider: string;
  budgetRawU: string;
  expiredAt: string;
  txHash: string | null;
  status: string;
}

export interface Erc8183JobView {
  id: string;
  client: string;
  provider: string;
  status: string;
  budgetRawU: string;
  description: string;
  expiredAt: string;
  deliverable: string | null;
  deliverableUrl: string | null;
}

export class ERC8183Adapter {
  private readonly session: Session;
  private readonly network: NetworkConfig;

  constructor(session: Session) {
    this.session = session;
    const env = serverEnv();
    this.network = env.ALTANA_NETWORK === "bnb-testnet" ? BNB_TESTNET : BNB;
  }

  /**
   * Hire an ERC-8183 provider: fund a job against `provider` for `budgetRawU`
   * $U in ONE atomic relay intent. Returns once the job is FUNDED on-chain.
   */
  async hire(params: Erc8183HireParams): Promise<Erc8183HireResult> {
    try {
      const result = await hireErc8183Agent(
        this.session,
        {
          provider: params.provider,
          task: params.task,
          budget: BigInt(params.budgetRawU),
          deadlineSeconds: params.deadlineSeconds,
        },
        { network: this.network },
      );
      logger.info({ jobId: result.jobId.toString(), provider: params.provider }, "erc8183 hire funded");
      return {
        jobId: result.jobId.toString(),
        provider: params.provider,
        budgetRawU: params.budgetRawU,
        expiredAt: result.expiredAt.toString(),
        txHash: result.transactionHash ?? null,
        status: result.status,
      };
    } catch (err) {
      logger.error({ err, provider: params.provider }, "erc8183 hire failed");
      throw new AppError("ERC8183_HIRE_FAILED", "The ERC-8183 hire transaction failed. See logs.", 500);
    }
  }

  /** Read a job from the commerce kernel (authoritative on-chain state). */
  async getJob(jobId: bigint): Promise<Erc8183JobView | null> {
    try {
      const job = await getErc8183Job(this.network, jobId);
      const deliverableUrl =
        job.statusName === "SUBMITTED" || job.statusName === "COMPLETED"
          ? await getErc8183DeliverableUrl(this.network, jobId).catch(() => undefined)
          : undefined;
      const zeroHash = "0x" + "00".repeat(32);
      return {
        id: job.id.toString(),
        client: job.client,
        provider: job.provider,
        status: job.statusName,
        budgetRawU: job.budget.toString(),
        description: job.description,
        expiredAt: job.expiredAt.toString(),
        deliverable: job.deliverable === zeroHash ? null : job.deliverable,
        deliverableUrl: deliverableUrl ?? null,
      };
    } catch (err) {
      logger.warn({ err, jobId: jobId.toString() }, "erc8183 job read failed");
      return null;
    }
  }

  /** Approve (release escrow) or dispute a submitted job. */
  async settle(jobId: bigint, action: "approve" | "dispute" = "approve"): Promise<void> {
    await settleErc8183Job(this.session, { jobId, action }, { network: this.network });
    logger.info({ jobId: jobId.toString(), action }, "erc8183 job settled");
  }
}
