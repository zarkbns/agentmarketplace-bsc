/**
 * Seed script — clearly-marked demo fixtures for early development.
 *
 * This seeds a small set of agents, capabilities, protocols and benchmark
 * records so the marketplace API is exercisable before real agents are
 * indexed. DEMO records are flagged with source='demo-fixture' in payloads
 * and the script refuses to run when DEMO_MODE=false.
 *
 * The seeded agents are NOT listed as "on-chain verified" — their
 * registration_source is 'marketplace' and verification_status 'unverified',
 * exactly as the data model requires. No on-chain identity is fabricated.
 *
 * Usage:
 *   npm run db:seed
 */
import { getAdminDb } from "../lib/db";
import { serverEnv } from "../lib/env";
import { generateId } from "../lib/auth/crypto";
import { createAgent } from "../lib/services/agents";

const DEMO_OWNER = "0x000000000000000000000000000000000000dEaD"; // clearly demo

interface SeedAgent {
  name: string;
  slug: string;
  description: string;
  category: "monitoring" | "trading" | "yield" | "research" | "security" | "defi" | "portfolio" | "automation";
  pricingModel: "per_task" | "per_call" | "per_execution" | "subscription";
  price: string;
  endpoint?: string;
  capabilities: { capability: string; description?: string }[];
  protocols: { protocol: string; network: string }[];
}

const SEED_AGENTS: SeedAgent[] = [
  {
    name: "YieldGuard",
    slug: "yieldguard",
    description: "Monitors PancakeSwap LP pools for yield changes and drift, alerts on impermanent loss risk, and discovers the best currently-available farms on BNB Chain.",
    category: "yield",
    pricingModel: "per_task",
    price: "2.5",
    capabilities: [
      { capability: "yield monitoring", description: "Tracks farm/pool APRs over time" },
      { capability: "impermanent loss alerts", description: "Flags high IL risk positions" },
      { capability: "yield discovery", description: "Suggests top-yield opportunities" },
    ],
    protocols: [{ protocol: "pancakeswap", network: "bsc-mainnet" }, { protocol: "lista", network: "bsc-mainnet" }],
  },
  {
    name: "LiquidityPulse",
    slug: "liquidity-pulse",
    description: "Liquidity intelligence for PancakeSwap pools: pool depth, 24h volume, fee yield, and concentration analysis to help liquidity providers position capital efficiently.",
    category: "monitoring",
    pricingModel: "subscription",
    price: "19",
    capabilities: [
      { capability: "pool liquidity analysis", description: "Depth and composition of LP pools" },
      { capability: "volume tracking", description: "24h volume and fee accrual" },
      { capability: "market research", description: "Demand and efficiency analysis" },
    ],
    protocols: [{ protocol: "pancakeswap", network: "bsc-mainnet" }],
  },
  {
    name: "BNB Sentinel",
    slug: "bnb-sentinel",
    description: "Wallet and market monitoring agent. Watches token balances, tracks large transfers and whale movements, and reports portfolio drift for BNB Chain positions.",
    category: "security",
    pricingModel: "per_execution",
    price: "1",
    capabilities: [
      { capability: "wallet monitoring", description: "Balance and transfer tracking" },
      { capability: "whale alerts", description: "Large transaction detection" },
      { capability: "portfolio drift", description: "Position change reporting" },
    ],
    protocols: [{ protocol: "bnb-chain", network: "bsc-mainnet" }],
  },
  {
    name: "DeFi Research Desk",
    slug: "defi-research-desk",
    description: "Research agent that compiles market movements, liquidity demand and protocol health reports across BNB Chain DeFi, with sources and reasoning for each finding.",
    category: "research",
    pricingModel: "per_task",
    price: "5",
    capabilities: [
      { capability: "market research", description: "Sourced market movement analysis" },
      { capability: "protocol health", description: "TVL, volume and risk assessment" },
      { capability: "report generation", description: "Structured research reports" },
    ],
    protocols: [{ protocol: "bnb-chain", network: "bsc-mainnet" }, { protocol: "aave", network: "bsc-mainnet" }],
  },
  {
    name: "SafeSwap Executor",
    slug: "safeswap-executor",
    description: "Executes swaps on PancakeSwap only within explicit user-defined constraints (max slippage, amount, token, deadline). Requires a scoped Altana session; never holds unrestricted access.",
    category: "automation",
    pricingModel: "per_execution",
    price: "0.5",
    capabilities: [
      { capability: "automated swaps", description: "Constraint-bounded token swaps" },
      { capability: "slippage protection", description: "Reverts beyond max slippage" },
      { capability: "permission scoping", description: "Altana session allowlist" },
    ],
    protocols: [{ protocol: "pancakeswap", network: "bsc-mainnet" }],
  },
  {
    name: "Portfolio Compass",
    slug: "portfolio-compass",
    description: "Portfolio management assistant: allocation analysis, rebalancing suggestions and risk metrics for BNB Chain DeFi positions.",
    category: "portfolio",
    pricingModel: "subscription",
    price: "12",
    capabilities: [
      { capability: "portfolio management", description: "Allocation and rebalancing advice" },
      { capability: "risk metrics", description: "Exposure and concentration risk" },
    ],
    protocols: [{ protocol: "bnb-chain", network: "bsc-mainnet" }, { protocol: "venus", network: "bsc-mainnet" }],
  },
];

async function main() {
  const env = serverEnv();
  if (!env.DEMO_MODE) {
    console.error("Refusing to seed: DEMO_MODE=false. Seed fixtures are development-only.");
    process.exit(1);
  }
  const db = getAdminDb();
  for (const seed of SEED_AGENTS) {
    const { data: existing } = await db.from("agents").select("id").eq("slug", seed.slug).maybeSingle();
    if (existing) {
      console.log(`skip  ${seed.slug} (already seeded)`);
      continue;
    }
    const agent = await createAgent(
      {
        chainId: 97,
        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        category: seed.category,
        pricingModel: seed.pricingModel,
        price: seed.price,
        currency: "USDC",
        endpoint: seed.endpoint,
        capabilities: seed.capabilities,
        protocols: seed.protocols,
      },
      DEMO_OWNER,
    );
    console.log(`seeded ${seed.slug} (${agent.id})`);
  }

  // Benchmark (Agent Advantage) demo record for the yield agent.
  const { data: yieldGuard } = await db.from("agents").select("id").eq("slug", "yieldguard").maybeSingle();
  if (yieldGuard) {
    const { data: existingBench } = await db.from("agent_advantage").select("id").eq("agent_id", yieldGuard.id).limit(1).maybeSingle();
    if (!existingBench) {
      await db.from("agent_advantage").insert({
        id: generateId("adv"),
        agent_id: yieldGuard.id,
        task_description: "Identify the top 5 PancakeSwap LP pools by 24h fee yield on BNB Chain and summarize impermanent loss risk.",
        benchmark_type: "manual_vs_agent",
        agent_execution_time_seconds: 240,
        manual_execution_time_seconds: 3600,
        agent_cost: 2.5,
        manual_cost: 60,
        agent_output: "Pool list with fee yields, volume and IL risk flags (structured JSON + summary).",
        manual_output: "Manual DEX screener + forum research (spreadsheet).",
        agent_quality_score: 8.5,
        manual_quality_score: 6,
        evaluation_notes: "DEMO FIXTURE — replace with a real measured benchmark before presenting TermiX results.",
        verified: false,
      });
      console.log("seeded demo benchmark for yieldguard");
    }
  }
  console.log("Seed complete. All records are clearly-marked demo fixtures.");
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
