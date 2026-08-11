import { createPublicClient, http, type PublicClient } from "viem";
import { serverEnv } from "../env";
import { chainConfig } from "./chains";

const clients = new Map<number, PublicClient>();

/**
 * Server-side viem public client for a chain. Reads only — no keys ever
 * live here. RPC URL is server-configured (BNB_RPC_URL); never exposed.
 */
export function publicClientFor(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const env = serverEnv();
  const url = env.BNB_RPC_URL;
  const client = createPublicClient({
    chain: chainConfig[chainId].chain,
    transport: http(url, {
      fetchOptions: { headers: {} },
      retryCount: 3,
      timeout: 15_000,
    }),
  });
  clients.set(chainId, client);
  return client;
}
