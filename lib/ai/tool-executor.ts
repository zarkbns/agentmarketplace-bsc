import { searchAgents } from "../services/search";
import { getAgentBySlug, getAgentById } from "../services/agents";
import { getTrendingAgents } from "../services/trending";
import { getUserHires } from "../services/hires";
import { getUserSessions } from "../services/sessions";
import type { Agent } from "../types";
import type { AiToolName } from "./tools";

/**
 * Executes AI tool calls against backend services on the server.
 *
 * Strict authorization boundary: every tool here is READ-ONLY or
 * informational. There are no tools that move funds, sign transactions,
 * grant/revoke permissions or execute financial actions. The user's wallet
 * remains the final authorization layer for anything financial.
 */
export class ToolExecutor {
  constructor(private readonly wallet: string | null) {}

  async execute(name: AiToolName, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "searchAgents":
        return this.search(args);
      case "getAgent":
        return this.getAgent(args);
      case "compareAgents":
        return this.compare(args);
      case "getTrendingAgents":
        return this.trending(args);
      case "getAgentPerformance":
        return this.performance(args);
      case "getAgentCapabilities":
        return this.capabilities(args);
      case "getAgentPermissions":
        return this.permissions();
      case "getUserHires":
        return this.requireWallet() ? this.hires() : { error: "Authentication required." };
      case "getUserSessions":
        return this.requireWallet() ? this.sessions() : { error: "Authentication required." };
      case "prepareHireInfo":
        return this.prepareHireInfo(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private requireWallet(): boolean {
    return this.wallet !== null && this.wallet !== undefined;
  }

  private async search(args: Record<string, unknown>) {
    const result = await searchAgents({
      q: typeof args.q === "string" ? args.q : undefined,
      category: typeof args.category === "string" ? (args.category as never) : undefined,
      protocol: typeof args.protocol === "string" ? args.protocol : undefined,
      minSuccessRate: typeof args.minSuccessRate === "number" ? args.minSuccessRate : undefined,
      sort: typeof args.sort === "string" ? (args.sort as never) : undefined,
      pageSize: Math.min(10, typeof args.limit === "number" ? args.limit : 10),
    });
    return {
      total: result.total,
      agents: result.agents.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        category: a.category,
        description: a.description,
        price: a.price,
        currency: a.currency,
        pricingModel: a.pricing_model,
        verificationStatus: a.verification_status,
        capabilities: a.capabilities.map((c) => c.capability),
        protocols: a.protocols.map((p) => p.protocol),
        performance: a.performance
          ? {
              successRate: a.performance.success_rate,
              tasksCompleted: a.performance.tasks_completed,
              averageExecutionTimeSeconds: a.performance.average_execution_time_seconds,
            }
          : null,
      })),
    };
  }

  private async getAgent(args: Record<string, unknown>) {
    const agent = typeof args.slug === "string" ? await getAgentBySlug(args.slug) : await getAgentById(args.id as string);
    return {
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      status: agent.status,
      pricingModel: agent.pricing_model,
      price: agent.price,
      currency: agent.currency,
      verificationStatus: agent.verification_status,
      onchainAgentId: agent.onchain_agent_id,
      capabilities: agent.capabilities,
      protocols: agent.protocols,
      performance: agent.performance,
      hireCount: agent.hire_count,
    };
  }

  private async compare(args: Record<string, unknown>) {
    const slugs = Array.isArray(args.slugs) ? (args.slugs as string[]).slice(0, 4) : [];
    const agents: Array<Agent | { slug: string; error: string }> = [];
    for (const slug of slugs) {
      try {
        agents.push(await getAgentBySlug(slug));
      } catch {
        agents.push({ slug, error: "not found" });
      }
    }
    return agents.map((a) => {
      if ("error" in a) return { slug: a.slug, error: a.error };
      return {
        name: a.name,
        category: a.category,
        price: a.price,
        currency: a.currency,
        pricingModel: a.pricing_model,
        capabilities: a.capabilities.map((c) => c.capability),
        successRate: a.performance?.success_rate ?? null,
        tasksCompleted: a.performance?.tasks_completed ?? 0,
        verification: a.verification_status,
      };
    });
  }

  private async trending(args: Record<string, unknown>) {
    const limit = typeof args.limit === "number" ? Math.min(10, args.limit) : 5;
    const trending = await getTrendingAgents(limit);
    const result = [];
    for (const t of trending) {
      try {
        const agent = await getAgentById(t.agentId);
        result.push({ slug: agent.slug, name: agent.name, score: Math.round(t.score * 100) / 100 });
      } catch {
        // agent may have been removed
      }
    }
    return result;
  }

  private async performance(args: Record<string, unknown>) {
    const agent = await getAgentBySlug(args.slug as string);
    return {
      slug: agent.slug,
      name: agent.name,
      successRate: agent.performance?.success_rate ?? null,
      tasksCompleted: agent.performance?.tasks_completed ?? 0,
      averageExecutionTimeSeconds: agent.performance?.average_execution_time_seconds ?? null,
      averageCost: agent.performance?.average_cost ?? null,
      currency: agent.performance?.currency ?? agent.currency,
      riskMetrics: agent.performance?.risk_metrics ?? null,
      evaluationWindowDays: agent.performance?.evaluation_window_days ?? null,
    };
  }

  private async capabilities(args: Record<string, unknown>) {
    const agent = await getAgentBySlug(args.slug as string);
    return agent.capabilities.map((c) => ({ capability: c.capability, description: c.description }));
  }

  private async permissions() {
    return {
      model: "Altana scoped sessions (on-chain)",
      description:
        "Hiring an agent can include granting a scoped Altana session: a spend cap, a call allowlist and an expiry, registered on-chain in the Altana KeyStore. The user authorizes and can revoke at any time. AgentGrid never moves funds without the user's wallet.",
    };
  }

  private async prepareHireInfo(args: Record<string, unknown>) {
    const agent = await getAgentBySlug(args.slug as string);
    return {
      agent: agent.name,
      price: agent.price,
      currency: agent.currency,
      pricingModel: agent.pricing_model,
      status: agent.status,
      note: "Hiring requires wallet authorization. This response does not create a hire.",
    };
  }

  private async hires() {
    const hires = await getUserHires(this.wallet!);
    return hires.map((h) => ({
      id: h.id,
      agentId: h.agent_id,
      task: h.task,
      status: h.status,
      price: h.price,
      currency: h.currency,
      txHash: h.transaction_hash,
      createdAt: h.created_at,
    }));
  }

  private async sessions() {
    const sessions = await getUserSessions(this.wallet!);
    return sessions.map((s) => ({
      id: s.id,
      agentId: s.agent_id,
      wallet: s.wallet_address,
      spendCap: s.spend_cap,
      status: s.status,
      expiry: s.expiry,
    }));
  }
}
