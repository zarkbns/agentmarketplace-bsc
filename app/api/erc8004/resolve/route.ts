import { z } from "zod";
import { handle, ok, parseBody } from "@/lib/api/response";
import { ERC8004Adapter } from "@/lib/adapters/erc8004";
import { requireAuth } from "@/lib/auth/session";
import { addressesFor } from "@/lib/blockchain/addresses";
import { AppError } from "@/lib/errors";

const resolveSchema = z.object({
  chainId: z.coerce.number().int().default(97),
  agentId: z.string().regex(/^\d+$/, "agentId must be a positive integer (ERC-8004 tokenId)"),
});

/**
 * POST /api/erc8004/resolve
 * Read an agent's on-chain identity from the ERC-8004 registry (read-only).
 * Used by the listing flow to validate identity BEFORE creating a listing.
 * Registration happens on the official registry — not here.
 */
export const POST = handle(async (request: Request) => {
  await requireAuth();
  const body = await parseBody(request, resolveSchema);
  const addresses = addressesFor(body.chainId);
  const adapter = new ERC8004Adapter(body.chainId);
  let identity;
  try {
    identity = await adapter.resolveIdentity(BigInt(body.agentId));
  } catch {
    throw new AppError("AGENT_NOT_FOUND", "No agent with this ID exists in the registry (or it could not be read).", 404, { registry: addresses.erc8004Registry });
  }
  const resolved = await adapter.resolveAgent(BigInt(body.agentId));
  const reputation = await adapter.getReputationSummary(BigInt(body.agentId));
  return ok({
    identity,
    registrationFile: resolved.registrationFile,
    metadataError: resolved.metadataError,
    reputation,
    registryAddress: addresses.erc8004Registry,
  });
});
