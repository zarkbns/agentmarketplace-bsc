import { getAdminDb } from "../db";
import { AppError } from "../errors";
import { generateId } from "../auth/crypto";
import { getAgentById } from "./agents";
import type { AgentAdvantage } from "../types";

/**
 * Agent Advantage (TermiX track) — manual vs agent benchmark records.
 *
 * Each record captures one real benchmark task:
 *   task, agent execution time, manual execution time, agent cost, manual
 *   cost, agent output, manual output, quality scores (0-10) and notes.
 * Records are created from actual measurements — no fabricated metrics.
 */

export interface AgentAdvantageInput {
  agentId: string;
  taskDescription: string;
  agentExecutionTimeSeconds?: number | null;
  manualExecutionTimeSeconds?: number | null;
  agentCost?: number | null;
  manualCost?: number | null;
  agentOutput?: string | null;
  manualOutput?: string | null;
  agentQualityScore?: number | null;
  manualQualityScore?: number | null;
  evaluationNotes?: string | null;
}

function validateScore(score: number | null | undefined, field: string): void {
  if (score != null && (score < 0 || score > 10)) {
    throw new AppError("VALIDATION_ERROR", `${field} must be between 0 and 10.`);
  }
}

export async function createAgentAdvantage(input: AgentAdvantageInput, userWallet: string): Promise<AgentAdvantage> {
  const agent = await getAgentById(input.agentId);
  if (agent.owner_wallet?.toLowerCase() !== userWallet.toLowerCase()) {
    throw new AppError("FORBIDDEN", "Only the agent owner can record benchmark data.", 403);
  }
  if (!input.taskDescription || input.taskDescription.trim().length < 10) {
    throw new AppError("VALIDATION_ERROR", "taskDescription must be at least 10 characters.");
  }
  validateScore(input.agentQualityScore, "agentQualityScore");
  validateScore(input.manualQualityScore, "manualQualityScore");

  const db = getAdminDb();
  const record: AgentAdvantage = {
    id: generateId("adv"),
    agent_id: agent.id,
    task_description: input.taskDescription.trim(),
    benchmark_type: "manual_vs_agent",
    agent_execution_time_seconds: input.agentExecutionTimeSeconds ?? null,
    manual_execution_time_seconds: input.manualExecutionTimeSeconds ?? null,
    agent_cost: input.agentCost ?? null,
    manual_cost: input.manualCost ?? null,
    agent_output: input.agentOutput ?? null,
    manual_output: input.manualOutput ?? null,
    agent_quality_score: input.agentQualityScore ?? null,
    manual_quality_score: input.manualQualityScore ?? null,
    evaluation_notes: input.evaluationNotes ?? null,
    verified: false,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("agent_advantage").insert(record).select().single();
  if (error) {
    throw new AppError("BENCHMARK_CREATE_FAILED", "Could not save the benchmark record.", 500, { db: error.message });
  }
  return data as AgentAdvantage;
}

export async function listAgentAdvantage(agentId: string): Promise<AgentAdvantage[]> {
  const db = getAdminDb();
  const { data } = await db
    .from("agent_advantage")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });
  return (data ?? []) as AgentAdvantage[];
}

/** Aggregate view across all benchmark records for an agent. */
export function summarizeAdvantage(records: AgentAdvantage[]): {
  recordCount: number;
  avgTimeSavingPct: number | null;
  avgCostSavingPct: number | null;
  avgQualityDelta: number | null;
} {
  if (records.length === 0) {
    return { recordCount: 0, avgTimeSavingPct: null, avgCostSavingPct: null, avgQualityDelta: null };
  }
  const withTimes = records.filter((r) => r.agent_execution_time_seconds != null && r.manual_execution_time_seconds != null && r.manual_execution_time_seconds > 0);
  const withCosts = records.filter((r) => r.agent_cost != null && r.manual_cost != null && r.manual_cost > 0);
  const withQuality = records.filter((r) => r.agent_quality_score != null && r.manual_quality_score != null);

  const avgTimeSavingPct = withTimes.length
    ? withTimes.reduce((sum, r) => sum + (1 - r.agent_execution_time_seconds! / r.manual_execution_time_seconds!) * 100, 0) / withTimes.length
    : null;
  const avgCostSavingPct = withCosts.length
    ? withCosts.reduce((sum, r) => sum + (1 - r.agent_cost! / r.manual_cost!) * 100, 0) / withCosts.length
    : null;
  const avgQualityDelta = withQuality.length
    ? withQuality.reduce((sum, r) => sum + (r.agent_quality_score! - r.manual_quality_score!), 0) / withQuality.length
    : null;

  return { recordCount: records.length, avgTimeSavingPct, avgCostSavingPct, avgQualityDelta };
}
