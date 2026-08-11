import { getAdminDb } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { generateId } from "../auth/crypto";
import { addressesFor } from "../blockchain/addresses";
import { publicClientFor } from "../blockchain/client";
import { recordActivity } from "./activity";
import { assertTransition, canTransition } from "./transactions";
import type { Hire, HireStatus, TxState } from "../types";
import { getAgentById } from "./agents";
import { serverEnv } from "../env";

/**
 * Hiring service — the hiring flow backend:
 *
 *   Discover → View → Configure task → Review price → [Permissions if
 *   required] → Wallet authorization → On-chain transaction → Agent
 *   execution → Result → Record outcome.
 *
 * Payment rails:
 *   - "native"  — user's wallet pays the agent provider in native BNB
 *                 (or $U via a direct ERC-20 transfer). The user signs and
 *                 broadcasts; the backend tracks confirmation on-chain and
 *                 NEVER reports success before confirmation.
 *   - "erc8183" — escrowed $U job on the ERC-8183 commerce kernel (requires
 *                 a configured Altana operator wallet).
 */

export interface PrepareHireInput {
  agentId: string;
  task: string;
  rail: "native" | "erc8183";
}

export interface PreparedHire {
  hire: Hire;
  tx: { id: string; state: TxState; address: string; amount: string; currency: string; method: string } | null;
  rail: "native" | "erc8183";
}

export async function prepareHire(input: PrepareHireInput, userWallet: string): Promise<PreparedHire> {
  const db = getAdminDb();
  const agent = await getAgentById(input.agentId);
  if (agent.status !== "active") {
    throw new AppError("AGENT_UNAVAILABLE", "This agent is not currently accepting hires.", 409);
  }
  if (input.task.trim().length < 10) {
    throw new AppError("VALIDATION_ERROR", "task must be at least 10 characters.");
  }
  if (input.task.length > 2000) {
    throw new AppError("VALIDATION_ERROR", "task must be at most 2000 characters.");
  }

  const price = Number(agent.price);
  if (Number.isNaN(price) || price <= 0) {
    throw new AppError("AGENT_UNAVAILABLE", "This agent has no valid price.", 409);
  }

  const id = generateId("hire");
  const now = new Date().toISOString();
  const { data: hire, error } = await db
    .from("hires")
    .insert({
      id,
      user_wallet: userWallet.toLowerCase(),
      agent_id: agent.id,
      task: input.task,
      status: "preparing",
      price: agent.price,
      currency: agent.currency,
      chain_id: serverEnv().ALTANA_NETWORK === "bnb-testnet" ? 97 : 56,
      created_at: now,
    })
    .select()
    .single();
  if (error) {
    throw new AppError("HIRE_CREATE_FAILED", "Could not prepare the hire.", 500, { db: error.message });
  }

  // Transaction intent record — starts CREATED → AWAITING_SIGNATURE.
  const txId = generateId("tx");
  const txState: TxState = "awaiting_signature";
  const { data: tx, error: txError } = await db
    .from("transactions")
    .insert({
      id: txId,
      hire_id: id,
      user_wallet: userWallet.toLowerCase(),
      chain_id: serverEnv().ALTANA_NETWORK === "bnb-testnet" ? 97 : 56,
      kind: input.rail === "erc8183" ? "erc8183_hire" : "payment",
      state: txState,
      method: input.rail === "erc8183" ? "commerce.fund" : "transfer",
      payload: { rail: input.rail, task: input.task },
    })
    .select()
    .single();
  if (txError) {
    throw new AppError("TX_CREATE_FAILED", "Could not create the transaction intent.", 500, { db: txError.message });
  }

  await db.from("hires").update({ status: "awaiting_signature" }).eq("id", id);

  return {
    hire: { ...(hire as unknown as Hire), status: "awaiting_signature" },
    rail: input.rail,
    tx: {
      id: tx.id,
      state: txState,
      address: agent.endpoint ?? "",
      amount: agent.price,
      currency: agent.currency,
      method: input.rail === "erc8183" ? "commerce.fund" : "transfer",
    },
  };
}

/**
 * Record that the user signed and broadcast a native payment.
 * The signature comes from the user's wallet (client-side); the backend
 * verifies the tx hash exists on-chain before moving past SUBMITTED.
 */
export async function submitNativePayment(input: {
  hireId: string;
  txId: string;
  txHash: string;
  userWallet: string;
}): Promise<{ state: TxState; hireStatus: HireStatus }> {
  const db = getAdminDb();
  const { data: tx, error } = await db
    .from("transactions")
    .select("*")
    .eq("id", input.txId)
    .eq("hire_id", input.hireId)
    .eq("user_wallet", input.userWallet.toLowerCase())
    .single();
  if (error || !tx) throw new AppError("TRANSACTION_NOT_FOUND", "Transaction intent not found.", 404);
  assertTransition(tx.state as TxState, "submitted");

  const now = new Date().toISOString();
  await db.from("transactions").update({ state: "submitted", tx_hash: input.txHash, updated_at: now }).eq("id", tx.id);
  await db.from("hires").update({ status: "funding", transaction_hash: input.txHash }).eq("id", input.hireId);
  await recordActivity({
    type: "transaction",
    agentId: tx.payload?.agentId ?? null,
    userWallet: input.userWallet,
    transactionHash: input.txHash,
  });
  return { state: "submitted", hireStatus: "funding" };
}

/**
 * Refresh transaction + hire state from the blockchain. Only a CONFIRMED
 * receipt advances the transaction; anything else leaves the tx pending.
 */
export async function refreshHireConfirmation(input: { hireId: string; userWallet: string }): Promise<{
  txState: TxState;
  hireStatus: HireStatus;
  confirmed: boolean;
}> {
  const db = getAdminDb();
  const { data: hire } = await db
    .from("hires")
    .select("*")
    .eq("id", input.hireId)
    .eq("user_wallet", input.userWallet.toLowerCase())
    .single();
  if (!hire || !hire.transaction_hash) {
    throw new AppError("HIRE_NOT_FOUND", "Hire or transaction hash not found.", 404);
  }
  const chainId = hire.chain_id as number;
  const client = publicClientFor(chainId);
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: hire.transaction_hash });
  } catch {
    receipt = null; // still pending (or not yet broadcast)
  }

  if (!receipt) {
    return { txState: "pending", hireStatus: hire.status as HireStatus, confirmed: false };
  }
  if (receipt.status !== "success") {
    await db.from("transactions").update({ state: "failed", error: "transaction reverted on-chain", updated_at: new Date().toISOString() }).eq("hire_id", hire.id);
    await db.from("hires").update({ status: "failed", error: "transaction reverted on-chain" }).eq("id", hire.id);
    await recordActivity({ type: "task_failed", agentId: hire.agent_id, userWallet: input.userWallet, transactionHash: hire.transaction_hash });
    return { txState: "failed", hireStatus: "failed", confirmed: false };
  }

  const now = new Date().toISOString();
  await db.from("transactions").update({ state: "confirmed", updated_at: now }).eq("hire_id", hire.id);
  await db.from("hires").update({ status: "active", started_at: now }).eq("id", hire.id);
  await recordActivity({ type: "hire", agentId: hire.agent_id, userWallet: input.userWallet, transactionHash: hire.transaction_hash });
  return { txState: "confirmed", hireStatus: "active", confirmed: true };
}

/**
 * ERC-8183 rail: hire via the commerce kernel using an Altana session.
 * Requires ALTANA_ADMIN_PRIVATE_KEY. The job is funded on-chain in one
 * atomic relay intent; the jobId is authoritative for the escrow.
 */
export async function erc8183Hire(input: { hireId: string; txId: string; userWallet: string }): Promise<{
  jobId: string;
  txState: TxState;
}> {
  const env = serverEnv();
  if (!env.ALTANA_ADMIN_PRIVATE_KEY) {
    throw new AppError("ALTANA_NOT_CONFIGURED", "ERC-8183 escrow hiring is not enabled on this deployment.", 501);
  }
  const db = getAdminDb();
  const { data: hire } = await db.from("hires").select("*").eq("id", input.hireId).eq("user_wallet", input.userWallet.toLowerCase()).single();
  if (!hire) throw new AppError("HIRE_NOT_FOUND", "Hire not found.", 404);
  const agent = await getAgentById(hire.agent_id);
  if (!agent.onchain?.agent_wallet) {
    throw new AppError("AGENT_UNAVAILABLE", "This agent has no on-chain payment address to hire.", 409);
  }

  const { AltanaAdapter } = await import("../adapters/altana");
  const { ERC8183Adapter } = await import("../adapters/erc8183");
  const adapter = new AltanaAdapter();
  // Agent-owned wallet: create one (or reuse the agent's registered wallet).
  const wallet = await adapter.createAgentWallet();
  // Session scoped to the commerce kernel (buyer side).
  const session = await adapter.createSession({
    walletAddress: wallet.address,
    permissions: {
      allowedCalls: [],
      spendCap: { token: addressesFor(env.ALTANA_NETWORK === "bnb-testnet" ? 97 : 56).paymentToken, limit: hire.price },
      period: "day",
    },
    expiry: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  });
  const erc8183 = new ERC8183Adapter(session);
  const result = await erc8183.hire({
    provider: agent.onchain.agent_wallet,
    task: hire.task,
    budgetRawU: hire.price, // $U has 18 decimals; price is stored raw
  });

  const now = new Date().toISOString();
  await db.from("transactions").update({ state: "confirmed", tx_hash: result.txHash, payload: { jobId: result.jobId }, updated_at: now }).eq("id", input.txId);
  await db.from("hires").update({ status: "active", started_at: now, transaction_hash: result.txHash, result_reference: `erc8183:job:${result.jobId}` }).eq("id", hire.id);
  await recordActivity({ type: "hire", agentId: hire.agent_id, userWallet: input.userWallet, transactionHash: result.txHash, payload: { rail: "erc8183", jobId: result.jobId } });
  logger.info({ hireId: input.hireId, jobId: result.jobId }, "erc8183 hire active");
  return { jobId: result.jobId, txState: "confirmed" };
}

/**
 * Execute the hired agent's task. Calls the agent endpoint (if published).
 * Results are stored as result_reference + summary. Performance metrics are
 * only updated from REAL executions; a demo execution (DEMO_MODE) never
 * writes performance data.
 */
export async function executeHire(input: { hireId: string; userWallet: string }): Promise<{ status: HireStatus; resultSummary: string | null; resultReference: string | null }> {
  const db = getAdminDb();
  const { data: hire } = await db.from("hires").select("*").eq("id", input.hireId).eq("user_wallet", input.userWallet.toLowerCase()).single();
  if (!hire) throw new AppError("HIRE_NOT_FOUND", "Hire not found.", 404);
  const agent = await getAgentById(hire.agent_id);
  // Execution is allowed from active/funding states (pre-execution states
  // reject the call; post-completion states are terminal).
  if (hire.status !== "active" && hire.status !== "funding") {
    throw new AppError("HIRE_NOT_EXECUTABLE", `Cannot execute a hire in state ${hire.status}.`, 409);
  }

  let resultSummary: string | null = null;
  let resultReference: string | null = null;
  let executed = false;

  if (agent.endpoint) {
    try {
      const res = await fetch(agent.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: hire.task, hireId: hire.id, userWallet: hire.user_wallet }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { result?: unknown; reference?: string };
        resultReference = body.reference ?? `${agent.endpoint}#${hire.id}`;
        resultSummary = typeof body.result === "string" ? body.result : JSON.stringify(body.result ?? { ok: true });
        executed = true;
      } else {
        throw new Error(`agent endpoint returned HTTP ${res.status}`);
      }
    } catch (err) {
      logger.warn({ err, hireId: hire.id, endpoint: agent.endpoint }, "agent execution failed");
      await recordActivity({ type: "task_failed", agentId: agent.id, userWallet: input.userWallet, transactionHash: hire.transaction_hash, payload: { reason: "endpoint_unreachable" } });
      throw new AppError(ErrorCode.AGENT_EXECUTION_FAILED, "The agent could not complete the task. The agent endpoint is unavailable.", 502);
    }
  } else if (serverEnv().DEMO_MODE) {
    // Clearly-marked demo execution: no endpoint published, DEMO_MODE on.
    resultSummary = "[DEMO] Execution completed against a demo runner. Configure the agent endpoint for real execution.";
    resultReference = `demo:${hire.id}`;
    executed = true;
  } else {
    throw new AppError("AGENT_UNAVAILABLE", "This agent has no execution endpoint.", 501);
  }

  const now = new Date().toISOString();
  await db.from("hires").update({
    status: "completed",
    completed_at: now,
    result_reference: resultReference,
    result_summary: resultSummary,
  }).eq("id", hire.id);
  await recordActivity({ type: "task_completed", agentId: agent.id, userWallet: input.userWallet, transactionHash: hire.transaction_hash, payload: { resultReference } });

  // Performance is updated ONLY from real executions (executed via endpoint).
  if (executed && agent.endpoint) {
    await updatePerformanceFromExecution(agent.id);
  }
  return { status: "completed", resultSummary, resultReference };
}

/** Real execution bookkeeping: increment tasks, refresh success rate. */
async function updatePerformanceFromExecution(agentId: string): Promise<void> {
  const db = getAdminDb();
  const { data: perf } = await db.from("agent_performance").select("*").eq("agent_id", agentId).maybeSingle();
  const tasksCompleted = (perf?.tasks_completed ?? 0) + 1;
  // Success rate is derived from real hires for this agent.
  const { count: totalTasks } = await db.from("hires").select("id", { count: "exact", head: true }).eq("agent_id", agentId).in("status", ["completed", "failed"]);
  const { count: failed } = await db.from("hires").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("status", "failed");
  const successRate = totalTasks && totalTasks > 0 ? (totalTasks - (failed ?? 0)) / totalTasks : null;
  await db.from("agent_performance").upsert({
    agent_id: agentId,
    tasks_completed: tasksCompleted,
    success_rate: successRate,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_id" });
}

/** List a user's hires (newest first). */
export async function getUserHires(userWallet: string): Promise<Hire[]> {
  const db = getAdminDb();
  const { data } = await db
    .from("hires")
    .select("*")
    .eq("user_wallet", userWallet.toLowerCase())
    .order("created_at", { ascending: false });
  return (data ?? []) as Hire[];
}

/** Update a hire/transaction to a cancelled or rejected state. */
export async function cancelHire(input: { hireId: string; userWallet: string; state: "cancelled" | "rejected" }): Promise<void> {
  const db = getAdminDb();
  const { data: tx } = await db.from("transactions").select("*").eq("hire_id", input.hireId).eq("user_wallet", input.userWallet.toLowerCase()).maybeSingle();
  if (tx && canTransition(tx.state as TxState, input.state)) {
    await db.from("transactions").update({ state: input.state, updated_at: new Date().toISOString() }).eq("id", tx.id);
  }
  await db.from("hires").update({ status: input.state, error: input.state === "rejected" ? "signature rejected by user" : "cancelled by user" }).eq("id", input.hireId);
}
