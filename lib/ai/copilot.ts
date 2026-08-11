import OpenAI from "openai";
import { serverEnv } from "../env";
import { logger } from "../logger";
import { aiTools, type AiToolName } from "./tools";
import { ToolExecutor } from "./tool-executor";

/**
 * Global marketplace copilot + contextual agent copilot.
 *
 * The AI calls backend services through tools (search, compare, explain).
 * It can PREPARE a hire explanation but never signs or authorizes financial
 * actions — the wallet remains the final authorization layer.
 */
export class Copilot {
  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor() {
    const env = serverEnv();
    this.model = env.AI_MODEL;
    if (env.AI_API_KEY) {
      this.client = new OpenAI({ apiKey: env.AI_API_KEY, baseURL: env.AI_BASE_URL });
    } else {
      this.client = null;
    }
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  /** Build the system prompt, optionally contextualized to a viewed agent. */
  private systemPrompt(context?: { agentName?: string; agentSlug?: string }): string {
    const env = serverEnv();
    const base =
      env.AI_SYSTEM_PROMPT ??
      [
        "You are the AgentGrid copilot — the AI assistant for a marketplace of autonomous AI agents on BNB Chain.",
        "You help users discover agents, understand capabilities, compare options and evaluate performance.",
        "You answer from marketplace data only. If data is missing, say so clearly.",
        "You can prepare a hire explanation but you never sign, move funds, grant/revoke permissions or execute financial transactions.",
        "The user's wallet is the final authorization layer for any financial action.",
      ].join("\n");
    if (context?.agentName) {
      return [
        base,
        "",
        `The user is currently viewing the agent "${context.agentName}" (slug: ${context.agentSlug}).`,
        "Prefer answering about this agent when relevant, using getAgent/getAgentPerformance/getAgentCapabilities.",
      ].join("\n");
    }
    return base;
  }

  /**
   * Run a chat turn. Returns the assistant reply (plain text) and a list of
   * tool calls that were executed for transparency.
   */
  async chat(input: {
    messages: { role: "user" | "assistant"; content: string }[];
    wallet: string | null;
    context?: { agentName?: string; agentSlug?: string };
  }): Promise<{ reply: string; toolsUsed: string[] }> {
    if (!this.client) {
      return {
        reply: "The AI copilot is not configured on this deployment (missing AI_API_KEY). Ask your administrator to configure the AI provider — see .env.example.",
        toolsUsed: [],
      };
    }

    const executor = new ToolExecutor(input.wallet);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemPrompt(input.context) },
      ...input.messages,
    ];
    const toolsUsed: string[] = [];

    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: [...aiTools],
        tool_choice: "auto",
        max_tokens: 1000,
      });

      const message = completion.choices[0]?.message;
      if (!message) {
        return { reply: "The model returned no response.", toolsUsed };
      }

      let reply = message.content ?? "";
      const toolCalls = message.tool_calls ?? [];

      if (toolCalls.length > 0) {
        messages.push(message);
        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          const name = call.function.name as AiToolName;
          toolsUsed.push(name);
          let result: unknown;
          try {
            const args = safeParse(call.function.arguments);
            result = await executor.execute(name, args);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : "tool execution failed" };
            logger.warn({ err, tool: name }, "ai tool execution failed");
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }
        const second = await this.client.chat.completions.create({
          model: this.model,
          messages,
          max_tokens: 1000,
        });
        reply = second.choices[0]?.message.content ?? "";
      }
      return { reply: reply || "(no text response)", toolsUsed };
    } catch (err) {
      logger.error({ err }, "copilot chat failed");
      return {
        reply: "The copilot encountered an error while processing your question. Please try again.",
        toolsUsed,
      };
    }
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

let cachedCopilot: Copilot | null = null;
export function getCopilot(): Copilot {
  if (!cachedCopilot) cachedCopilot = new Copilot();
  return cachedCopilot;
}
