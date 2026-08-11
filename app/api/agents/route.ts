import { z } from "zod";
import { handle, ok, parseQuery, parseBody } from "@/lib/api/response";
import { searchAgents } from "@/lib/services/search";
import { createAgent } from "@/lib/services/agents";
import { requireAuth } from "@/lib/auth/session";
import { requireAddress } from "@/lib/validation";
import { AGENT_CATEGORIES, PRICING_MODELS } from "@/lib/types";
import { publicEnv } from "@/lib/env";

const querySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  protocol: z.string().optional(),
  pricingModel: z.string().optional(),
  status: z.string().optional(),
  verification: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minSuccessRate: z.coerce.number().min(0).max(1).optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

/** GET /api/agents — discover agents (search/filter/sort/paginate). */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(new URL(request.url), querySchema);
  const result = await searchAgents({
    q: query.q,
    category: query.category as never,
    protocol: query.protocol,
    pricingModel: query.pricingModel,
    status: query.status,
    verification: query.verification,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    minSuccessRate: query.minSuccessRate,
    sort: query.sort as never,
    page: query.page,
    pageSize: query.pageSize,
  });
  return ok(result.agents, {
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    pages: result.pages,
  });
});

const createSchema = z.object({
  // On-chain identity (import from ERC-8004 — read-only; the agent must
  // already be registered on the official registry).
  chainId: z.coerce.number().int().optional().default(97),
  agentId: z.string().optional(),
  registryAddress: z.string().optional(),
  // Marketplace profile.
  name: z.string(),
  slug: z.string(),
  description: z.string().default(""),
  category: z.enum(AGENT_CATEGORIES),
  pricingModel: z.enum(PRICING_MODELS),
  price: z.string().default("0"),
  currency: z.string().default("USDC"),
  endpoint: z.string().optional(),
  imageUri: z.string().optional(),
  metadataUri: z.string().optional(),
  capabilities: z.array(z.object({ capability: z.string(), description: z.string().optional() })).default([]),
  protocols: z.array(z.object({ protocol: z.string(), network: z.string().default("bsc-mainnet") })).default([]),
});

/** POST /api/agents — list an agent on the marketplace (validated). */
export const POST = handle(async (request: Request) => {
  const auth = await requireAuth();
  const body = await parseBody(request, createSchema);
  const claimingWallet = requireAddress(auth.wallet, "wallet");
  const agent = await createAgent(
    {
      chainId: body.chainId ?? publicEnv.NEXT_PUBLIC_CHAIN_ID,
      agentId: body.agentId,
      registryAddress: body.registryAddress,
      name: body.name,
      slug: body.slug,
      description: body.description,
      category: body.category,
      pricingModel: body.pricingModel,
      price: body.price,
      currency: body.currency,
      endpoint: body.endpoint,
      imageUri: body.imageUri,
      metadataUri: body.metadataUri,
      capabilities: body.capabilities,
      protocols: body.protocols,
    },
    claimingWallet,
  );
  return ok(agent, {}, 201);
});

/** GET /api/agents/mine — agents owned by the signed-in wallet. */
export { GET as GetMine };
