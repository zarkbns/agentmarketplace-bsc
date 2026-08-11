import { z } from "zod";
import { handle, ok, parseQuery, parseBody } from "@/lib/api/response";
import { createAgentAdvantage, listAgentAdvantage, summarizeAdvantage } from "@/lib/services/benchmarks";
import { requireAuth } from "@/lib/auth/session";

const querySchema = z.object({ agentId: z.string().optional() });

/** GET /api/benchmarks?agentId= — Agent Advantage benchmark records. */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(new URL(request.url), querySchema);
  const records = query.agentId ? await listAgentAdvantage(query.agentId) : [];
  return ok({ records, summary: summarizeAdvantage(records) });
});

const createSchema = z.object({
  agentId: z.string().min(1),
  taskDescription: z.string().min(10).max(2000),
  agentExecutionTimeSeconds: z.coerce.number().positive().optional().nullable(),
  manualExecutionTimeSeconds: z.coerce.number().positive().optional().nullable(),
  agentCost: z.coerce.number().nonnegative().optional().nullable(),
  manualCost: z.coerce.number().nonnegative().optional().nullable(),
  agentOutput: z.string().max(4000).optional().nullable(),
  manualOutput: z.string().max(4000).optional().nullable(),
  agentQualityScore: z.coerce.number().min(0).max(10).optional().nullable(),
  manualQualityScore: z.coerce.number().min(0).max(10).optional().nullable(),
  evaluationNotes: z.string().max(2000).optional().nullable(),
});

/** POST /api/benchmarks — record a manual-vs-agent benchmark (TermiX). */
export const POST = handle(async (request: Request) => {
  const auth = await requireAuth();
  const body = await parseBody(request, createSchema);
  const record = await createAgentAdvantage(
    {
      agentId: body.agentId,
      taskDescription: body.taskDescription,
      agentExecutionTimeSeconds: body.agentExecutionTimeSeconds,
      manualExecutionTimeSeconds: body.manualExecutionTimeSeconds,
      agentCost: body.agentCost,
      manualCost: body.manualCost,
      agentOutput: body.agentOutput,
      manualOutput: body.manualOutput,
      agentQualityScore: body.agentQualityScore,
      manualQualityScore: body.manualQualityScore,
      evaluationNotes: body.evaluationNotes,
    },
    auth.wallet,
  );
  return ok(record, {}, 201);
});
