import { getAddress } from "viem";
import { ERC8004Adapter } from "../adapters/erc8004";
import { getAdminDb, type Db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { generateId } from "../auth/crypto";
import {
  AGENT_CATEGORIES,
  PRICING_MODELS,
  type Agent,
  type AgentCategory,
  type PricingModel,
} from "../types";
import { addressesFor } from "../blockchain/addresses";

/**
 * Agent service — marketplace records for agents.
 *
 * Listing an agent NEVER fabricates on-chain identity. A listing is either:
 *  - imported from the ERC-8004 registry (registry_address + onchain_agent_id
 *    read live from the registry at listing time), or
 *  - a marketplace-only listing (registration_source = 'marketplace'), where
 *    the agent has no on-chain identity and the data model says so explicitly.
 */

export interface AgentCreateInput {
  // On-chain identity (optional — see registration_source)
  chainId: number;
  agentId?: string; // ERC-8004 tokenId when importing from the registry
  registryAddress?: string;
  // Marketplace profile
  name: string;
  slug: string;
  description: string;
  category: AgentCategory;
  pricingModel: PricingModel;
  price: string;
  currency: string;
  endpoint?: string;
  imageUri?: string;
  metadataUri?: string;
  capabilities: { capability: string; description?: string }[];
  protocols: { protocol: string; network: string }[];
}

const NAME_RE = /^[a-zA-Z0-9 _\-'.]{2,80}$/;
const SLUG_RE = /^[a-z0-9-]{2,80}$/;

export function validateAgentInput(input: AgentCreateInput): void {
  if (!NAME_RE.test(input.name)) {
    throw new AppError("VALIDATION_ERROR", "name must be 2-80 chars: letters, digits, spaces, . - ' _");
  }
  if (!SLUG_RE.test(input.slug)) {
    throw new AppError("VALIDATION_ERROR", "slug must be 2-80 chars: lowercase letters, digits, hyphens.");
  }
  if (input.description && input.description.length > 2000) {
    throw new AppError("VALIDATION_ERROR", "description must be at most 2000 characters.");
  }
  if (!AGENT_CATEGORIES.includes(input.category)) {
    throw new AppError("VALIDATION_ERROR", `category must be one of: ${AGENT_CATEGORIES.join(", ")}.`);
  }
  if (!PRICING_MODELS.includes(input.pricingModel)) {
    throw new AppError("VALIDATION_ERROR", `pricingModel must be one of: ${PRICING_MODELS.join(", ")}.`);
  }
  if (input.price && !/^\d+(\.\d{1,18})?$/.test(input.price)) {
    throw new AppError("VALIDATION_ERROR", "price must be a non-negative decimal string.");
  }
  if (input.endpoint && !input.endpoint.startsWith("http")) {
    throw new AppError("VALIDATION_ERROR", "endpoint must be an http(s) URL.");
  }
  if (input.capabilities.length > 20) {
    throw new AppError("VALIDATION_ERROR", "at most 20 capabilities are supported.");
  }
  for (const cap of input.capabilities) {
    if (!/^[a-zA-Z0-9 _\-:()]{2,60}$/.test(cap.capability)) {
      throw new AppError("VALIDATION_ERROR", "capability names must be 2-60 chars.");
    }
  }
  if (input.protocols.length > 12) {
    throw new AppError("VALIDATION_ERROR", "at most 12 protocols are supported.");
  }
}

/**
 * Validate the agent's on-chain identity when a listing claims ERC-8004
 * registration. Reads the registry live: the claimed registry address +
 * agentId must resolve, and the claiming owner must hold the identity NFT.
 * Returns the resolved identity; throws AGENT_NOT_FOUND otherwise.
 */
export async function validateOnchainIdentity(input: {
  chainId: number;
  registryAddress: string;
  agentId: string;
  claimingWallet: string;
}): Promise<{ agentUri: string | null; ownerAddress: string; agentWallet: string | null }> {
  const addresses = addressesFor(input.chainId);
  const registry = input.registryAddress.toLowerCase();
  if (registry !== addresses.erc8004Registry.toLowerCase()) {
    throw new AppError("INVALID_REGISTRY", "The provided registry address is not the ERC-8004 Identity Registry for this chain.", 422);
  }
  const agentId = BigInt(input.agentId);
  const adapter = new ERC8004Adapter(input.chainId);
  let identity;
  try {
    identity = await adapter.resolveIdentity(agentId);
  } catch (err) {
    logger.warn({ err, agentId: input.agentId }, "erc8004 identity resolution failed");
    throw new AppError("AGENT_NOT_FOUND", "No agent with this ID exists in the registry (or it could not be read).", 404);
  }
  if (identity.ownerAddress?.toLowerCase() !== input.claimingWallet.toLowerCase()) {
    throw new AppError(
      "NOT_AGENT_OWNER",
      "Only the ERC-8004 identity owner can list this agent. The wallet you connected is not the registered owner.",
      403,
    );
  }
  return {
    agentUri: identity.agentUri,
    ownerAddress: identity.ownerAddress,
    agentWallet: identity.agentWallet,
  };
}

/** Create a marketplace listing (after validation). Returns the created agent. */
export async function createAgent(input: AgentCreateInput, claimingWallet: string): Promise<Agent> {
  validateAgentInput(input);
  const db = getAdminDb();

  let onchainAgentId: string | null = null;
  let registryAddress: string | null = null;
  let ownerWallet: string | null = null;
  let metadataUri: string | null = input.metadataUri ?? null;
  let verificationStatus: Agent["verification_status"] = "unverified";

  if (input.agentId && input.registryAddress) {
    const identity = await validateOnchainIdentity({
      chainId: input.chainId,
      registryAddress: input.registryAddress,
      agentId: input.agentId,
      claimingWallet,
    });
    onchainAgentId = input.agentId;
    registryAddress = getAddress(input.registryAddress);
    ownerWallet = identity.ownerAddress;
    metadataUri = identity.agentUri ?? metadataUri;
    verificationStatus = "registry_verified";
  } else {
    // Marketplace-only listing: explicit, no fabricated on-chain identity.
    ownerWallet = getAddress(claimingWallet);
    verificationStatus = "unverified";
  }

  const slug = await uniqueSlug(db, input.slug);
  const id = generateId("agent");
  const now = new Date().toISOString();
  const { error } = await db
    .from("agents")
    .insert({
      id,
      onchain_agent_id: onchainAgentId,
      registry_address: registryAddress,
      owner_wallet: ownerWallet,
      name: input.name,
      slug,
      description: input.description,
      category: input.category,
      status: "active",
      pricing_model: input.pricingModel,
      price: input.price || "0",
      currency: input.currency || "USDC",
      endpoint: input.endpoint ?? null,
      metadata_uri: metadataUri,
      image_uri: input.imageUri ?? null,
      verification_status: verificationStatus,
      registration_source: onchainAgentId ? "erc8004_registry" : "marketplace",
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) {
    throw new AppError("AGENT_CREATE_FAILED", "Could not create the agent listing.", 500, { db: error.message });
  }

  if (input.capabilities.length > 0) {
    await db.from("agent_capabilities").insert(
      input.capabilities.map((c) => ({
        id: generateId("cap"),
        agent_id: id,
        capability: c.capability,
        description: c.description ?? null,
      })),
    );
  }
  if (input.protocols.length > 0) {
    await db.from("agent_protocols").insert(
      input.protocols.map((p) => ({
        agent_id: id,
        protocol: p.protocol,
        network: p.network,
      })),
    );
  }
  await db.from("agent_performance").insert({
    agent_id: id,
    tasks_completed: 0,
    currency: input.currency || "USDC",
  });
  await recordActivity({
    type: "new_listing",
    agentId: id,
    userWallet: ownerWallet ?? null,
    payload: { name: input.name, registrationSource: onchainAgentId ? "erc8004" : "marketplace" },
  });

  logger.info({ agentId: id, slug, onchain: onchainAgentId !== null }, "agent listed");
  return getAgentById(id);
}

export async function getAgentById(id: string, db: Db = getAdminDb()): Promise<Agent> {
  const { data, error } = await db.from("agents").select("*").eq("id", id).single();
  if (error || !data) throw new AppError(ErrorCode.AGENT_NOT_FOUND, "Agent could not be found.", 404);
  return enrichAgent(data);
}

export async function getAgentBySlug(slug: string, db: Db = getAdminDb()): Promise<Agent> {
  const { data, error } = await db.from("agents").select("*").eq("slug", slug).single();
  if (error || !data) throw new AppError(ErrorCode.AGENT_NOT_FOUND, "Agent could not be found.", 404);
  return enrichAgent(data);
}

/** Increment the view counter for an agent (used by trending). */
export async function recordAgentView(agentId: string, viewerWallet: string | null): Promise<void> {
  const db = getAdminDb();
  await db.from("agent_views").insert({ agent_id: agentId, viewer_wallet: viewerWallet });
}

/** Attach capabilities, protocols, performance and hire counts. */
export async function enrichAgent(row: Record<string, unknown>, db: Db = getAdminDb()): Promise<Agent> {
  const [caps, protocols, performance, hires] = await Promise.all([
    db.from("agent_capabilities").select("id, agent_id, capability, description").eq("agent_id", row.id),
    db.from("agent_protocols").select("agent_id, protocol, network").eq("agent_id", row.id),
    db.from("agent_performance").select("*").eq("agent_id", row.id).maybeSingle(),
    db.from("hires").select("id", { count: "exact", head: true }).eq("agent_id", row.id).neq("status", "cancelled"),
  ]);
  return {
    ...(row as unknown as Agent),
    capabilities: caps.data ?? [],
    protocols: protocols.data ?? [],
    performance: performance.data ?? null,
    hire_count: hires.count ?? 0,
    trending_score: 0,
  };
}

export async function uniqueSlug(db: Db, slug: string): Promise<string> {
  const { data } = await db.from("agents").select("slug").eq("slug", slug).maybeSingle();
  if (!data) return slug;
  let i = 2;
  while (true) {
    const candidate = `${slug}-${i}`;
    const { data: existing } = await db.from("agents").select("slug").eq("slug", candidate).maybeSingle();
    if (!existing) return candidate;
    i += 1;
  }
}

/** Agents owned by a wallet. */
export async function getAgentsByOwner(wallet: string): Promise<Agent[]> {
  const db = getAdminDb();
  const { data } = await db
    .from("agents")
    .select("*")
    .eq("owner_wallet", wallet.toLowerCase())
    .order("created_at", { ascending: false });
  return Promise.all((data ?? []).map((row) => enrichAgent(row)));
}

import { recordActivity } from "./activity";
