import type { ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * AI tool/function definitions. The AI calls backend services (server-side)
 * — never Supabase directly from the browser.
 *
 * Authorization boundary: these tools are READ/SEARCH/PREPARE only. The AI
 * must never sign, move funds, grant or revoke permissions, or execute
 * financial transactions. Wallet authorization stays with the user.
 */
export const aiTools = [
  {
    type: "function",
    function: {
      name: "searchAgents",
      description:
        "Search the AgentGrid marketplace. Supports a text query, category, protocol, pricing model, minimum success rate and sort order. Returns paginated agent results with capabilities, protocols and performance.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "Free-text query over name, description, capabilities." },
          category: { type: "string", description: "monitoring | trading | yield | research | security | defi | portfolio | automation" },
          protocol: { type: "string", description: "bnb-chain | pancakeswap | venus | aave | lista | altana" },
          minSuccessRate: { type: "number", description: "Minimum success rate, 0..1" },
          sort: { type: "string", description: "relevance | trending | newest | most_hired | reputation | success_rate | lowest_price" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAgent",
      description: "Get a single agent by slug or id, including capabilities, protocols, performance and on-chain identity.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          id: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compareAgents",
      description: "Compare two or more agents side by side (capabilities, pricing, performance).",
      parameters: {
        type: "object",
        properties: {
          slugs: { type: "array", items: { type: "string" }, description: "2-4 agent slugs" },
        },
        required: ["slugs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTrendingAgents",
      description: "Get the currently trending agents in the marketplace with their trending scores.",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", default: 5 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAgentPerformance",
      description: "Get verified performance metrics for an agent (success rate, tasks completed, avg execution time, risk metrics).",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAgentCapabilities",
      description: "Get the capability list of an agent.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAgentPermissions",
      description: "Describe the permission model AgentGrid uses for hiring (Altana scoped sessions) and what an agent would be able to do.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getUserHires",
      description: "List the signed-in user's hires and their statuses. Only callable when the user is authenticated.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "getUserSessions",
      description: "List the signed-in user's active Altana permission sessions. Only callable when the user is authenticated.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "prepareHireInfo",
      description: "Explain what hiring a specific agent involves: price, pricing model, currency and any requirements. Does NOT create a hire.",
      parameters: {
        type: "object",
        properties: { slug: { type: "string" } },
        required: ["slug"],
      },
    },
  },
] as const satisfies readonly ChatCompletionTool[];

export type AiToolName = (typeof aiTools)[number]["function"]["name"];
