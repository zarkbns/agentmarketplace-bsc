import { z } from "zod";
import { handle, ok, parseBody } from "@/lib/api/response";
import { getCopilot } from "@/lib/ai/copilot";
import { getSessionWallet } from "@/lib/auth/session";

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    }),
  ).min(1).max(20),
  contextAgentSlug: z.string().optional(),
});

/**
 * POST /api/ai/chat — the marketplace copilot.
 * Tools execute server-side against backend services; the AI never touches
 * the database directly and never authorizes financial actions.
 */
export const POST = handle(async (request: Request) => {
  const body = await parseBody(request, chatSchema);
  const session = await getSessionWallet();
  const copilot = getCopilot();

  let context: { agentName?: string; agentSlug?: string } | undefined;
  if (body.contextAgentSlug) {
    try {
      const { getAgentBySlug } = await import("@/lib/services/agents");
      const agent = await getAgentBySlug(body.contextAgentSlug);
      context = { agentName: agent.name, agentSlug: agent.slug };
    } catch {
      context = undefined;
    }
  }

  const result = await copilot.chat({
    messages: body.messages,
    wallet: session?.wallet ?? null,
    context,
  });

  return ok({
    reply: result.reply,
    toolsUsed: result.toolsUsed,
    copilotConfigured: copilot.isConfigured,
  });
});
