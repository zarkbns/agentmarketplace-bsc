import { getAddress, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { erc8004IdentityRegistryAbi, erc8004ReputationRegistryAbi } from "../blockchain/abis";
import { publicClientFor } from "../blockchain/client";
import { addressesFor } from "../blockchain/addresses";
import { AppError } from "../errors";
import { logger } from "../logger";

/**
 * ERC-8004 Identity Registry adapter.
 *
 * AgentGrid is a READER of the registry — agents are registered directly on
 * the official ERC-8004 registry. This adapter resolves on-chain identity,
 * fetches/normalizes the registration file, and provides event queries for
 * the indexer. It never writes to the registry.
 */

export interface OnchainAgentIdentity {
  chainId: number;
  registryAddress: Address;
  agentId: string; // stringified uint256
  agentUri: string | null;
  ownerAddress: Address | null;
  agentWallet: Address | null; // payment/signing address (may be unset)
}

export interface RegistrationService {
  name?: string;
  endpoint?: string;
  version?: string;
  skills?: string[];
  domains?: string[];
}

/** Canonical normalized registration file (EIP-8004 registration-v1). */
export interface RegistrationFile {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: RegistrationService[];
  x402Support?: boolean;
  active?: boolean;
  registrations?: { agentId: string | number; agentRegistry: string }[];
  supportedTrust?: string[];
  [key: string]: unknown; // preserve unknown fields for debugging
}

export interface ResolvedAgent {
  identity: OnchainAgentIdentity;
  registrationFile: RegistrationFile | null;
  rawRegistrationFile: unknown;
  metadataError: string | null;
  resolvedAt: string;
}

/** IPFS gateway used to resolve ipfs:// URIs. */
const IPFS_GATEWAY = process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs";

export class ERC8004Adapter {
  constructor(private readonly chainId: number) {}

  get client(): PublicClient {
    return publicClientFor(this.chainId);
  }

  get registryAddress(): Address {
    return addressesFor(this.chainId).erc8004Registry;
  }

  private registry() {
    return {
      address: this.registryAddress,
      abi: erc8004IdentityRegistryAbi,
    };
  }

  /**
   * Resolve the on-chain identity of an agent from the Identity Registry.
   * agentId is the ERC-8004 tokenId. Reads are authoritative on-chain state.
   */
  async resolveIdentity(agentId: bigint): Promise<OnchainAgentIdentity> {
    const reg = this.registry();
    const [uri, owner, wallet] = await Promise.all([
      this.client.readContract({ ...reg, functionName: "tokenURI", args: [agentId] }),
      this.client.readContract({ ...reg, functionName: "ownerOf", args: [agentId] }),
      this.client.readContract({ ...reg, functionName: "getAgentWallet", args: [agentId] }).catch(() => null),
    ]);
    return {
      chainId: this.chainId,
      registryAddress: this.registryAddress,
      agentId: agentId.toString(),
      agentUri: uri || null,
      ownerAddress: getAddress(owner),
      agentWallet: wallet ? getAddress(wallet) : null,
    };
  }

  /**
   * Fetch and normalize the registration file referenced by agentURI.
   * Supports https://, ipfs:// and data: URIs. Never mutates on-chain facts.
   */
  async fetchRegistrationFile(agentUri: string): Promise<{ raw: unknown; normalized: RegistrationFile }> {
    const raw = await this.fetchUri(agentUri);
    return { raw, normalized: this.normalizeRegistrationFile(raw) };
  }

  /** Resolve identity + registration file in one call (used by listing flow). */
  async resolveAgent(agentId: bigint): Promise<ResolvedAgent> {
    const identity = await this.resolveIdentity(agentId);
    let registrationFile: RegistrationFile | null = null;
    let rawRegistrationFile: unknown = null;
    let metadataError: string | null = null;
    if (identity.agentUri) {
      try {
        const fetched = await this.fetchRegistrationFile(identity.agentUri);
        registrationFile = fetched.normalized;
        rawRegistrationFile = fetched.raw;
      } catch (err) {
        metadataError = err instanceof Error ? err.message : "metadata fetch failed";
        logger.warn({ chainId: this.chainId, agentId: agentId.toString(), err }, "erc8004 metadata fetch failed");
      }
    }
    return {
      identity,
      registrationFile,
      rawRegistrationFile,
      metadataError,
      resolvedAt: new Date().toISOString(),
    };
  }

  /** Query Registered events in a block range (used by the indexer). */
  async getRegistrationEvents(fromBlock: bigint, toBlock: bigint): Promise<
    { agentId: bigint; agentUri: string; owner: Address; blockNumber: bigint; transactionHash: Hex; logIndex: number }[]
  > {
    const registeredEvent = parseAbiItem("event Registered(uint256 indexed agentId, string agentURI, address indexed owner)");
    const logs = await this.client.getLogs({
      address: this.registryAddress,
      event: registeredEvent,
      fromBlock,
      toBlock,
    });
    return logs.map((log) => ({
      agentId: log.args.agentId!,
      agentUri: log.args.agentURI ?? "",
      owner: getAddress(log.args.owner!),
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
    }));
  }

  /**
   * Best-effort reputation summary from the ERC-8004 Reputation Registry.
   * Returns null when the registry is not deployed on this chain or the call
   * reverts (reputation is optional per the standard).
   */
  async getReputationSummary(agentId: bigint, clientAddresses: Address[] = []): Promise<{
    count: number;
    summaryValue: string;
    summaryValueDecimals: number;
  } | null> {
    try {
      const reputationRegistry = addressesFor(this.chainId).erc8004Registry; // same vanity prefix family
      const [count, summaryValue, valueDecimals] = await this.client.readContract({
        address: reputationRegistry as Address,
        abi: erc8004ReputationRegistryAbi,
        functionName: "getSummary",
        args: [agentId, clientAddresses, "", ""],
      });
      return { count: Number(count), summaryValue: summaryValue.toString(), summaryValueDecimals: Number(valueDecimals) };
    } catch (err) {
      logger.debug({ err, chainId: this.chainId }, "reputation summary unavailable");
      return null;
    }
  }

  private async fetchUri(uri: string): Promise<unknown> {
    if (uri.startsWith("data:")) {
      const idx = uri.indexOf(",");
      if (idx === -1) throw new AppError("INVALID_AGENT_URI", "Malformed data URI.", 422);
      const [header, payload] = [uri.slice(0, idx), uri.slice(idx + 1)];
      const json = header.includes("base64") ? Buffer.from(payload, "base64").toString("utf8") : decodeURIComponent(payload);
      return JSON.parse(json);
    }
    const url = uri.startsWith("ipfs://")
      ? `${IPFS_GATEWAY}/${uri.slice("ipfs://".length)}`
      : uri;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new AppError("INVALID_AGENT_URI", `Unsupported agentURI scheme: ${uri.slice(0, 16)}…`, 422);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new AppError("AGENT_ENDPOINT_UNAVAILABLE", `Metadata fetch failed: HTTP ${res.status}.`, 502);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Normalize an arbitrary registration file into the canonical shape.
   * Unknown fields are preserved on the raw payload only — the normalized
   * record contains exactly the fields AgentGrid understands.
   */
  normalizeRegistrationFile(raw: unknown): RegistrationFile {
    if (!raw || typeof raw !== "object") {
      throw new AppError("INVALID_AGENT_METADATA", "Registration file must be a JSON object.", 422);
    }
    const record = raw as Record<string, unknown>;
    const pickString = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined);
    const services = Array.isArray(record.services)
      ? (record.services as Record<string, unknown>[]).map((s) => ({
          name: pickStringOf(s, "name"),
          endpoint: pickStringOf(s, "endpoint"),
          version: pickStringOf(s, "version"),
          skills: Array.isArray(s.skills) ? (s.skills as string[]) : undefined,
          domains: Array.isArray(s.domains) ? (s.domains as string[]) : undefined,
        }))
      : undefined;
    return {
      type: pickString("type"),
      name: pickString("name"),
      description: pickString("description"),
      image: pickString("image"),
      services,
      x402Support: typeof record.x402Support === "boolean" ? record.x402Support : undefined,
      active: typeof record.active === "boolean" ? record.active : undefined,
      registrations: Array.isArray(record.registrations) ? (record.registrations as { agentId: string | number; agentRegistry: string }[]) : undefined,
      supportedTrust: Array.isArray(record.supportedTrust) ? (record.supportedTrust as string[]) : undefined,
    };
  }
}

function pickStringOf(obj: Record<string, unknown> | null | undefined, key: string): string | undefined {
  return obj && typeof obj[key] === "string" ? (obj[key] as string) : undefined;
}

/** Current totalSupply of the registry (useful for indexer cursors). */
export async function getRegistryTotalAgents(chainId: number): Promise<bigint> {
  const client = publicClientFor(chainId);
  const addresses = addressesFor(chainId);
  return client.readContract({
    address: addresses.erc8004Registry,
    abi: erc8004IdentityRegistryAbi,
    functionName: "totalSupply",
  });
}
