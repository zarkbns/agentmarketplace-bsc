import { serverEnv } from "../env";
import { logger } from "../logger";
import { addressesFor } from "../blockchain/addresses";
import { publicClientFor } from "../blockchain/client";
import { erc20Abi } from "../blockchain/abis";
import { AppError } from "../errors";
import type { Address } from "viem";

/**
 * PancakeSwapAdapter — protocol/ecosystem integration (NOT a marketplace).
 *
 * AgentGrid uses PancakeSwap as a data source for agents that provide
 * liquidity intelligence, yield discovery and market research, plus SAFE
 * swap execution under explicit user-granted permission boundaries.
 *
 * Reads use the official PancakeSwap v3 subgraph (pools, liquidity, volume,
 * APR). Swap execution itself is never done by AgentGrid on the user's
 * behalf — it is a permission-restricted agent action gated by an Altana
 * session allowlist (see docs/architecture.md, "Safe automated swaps").
 *
 * The adapter degrades gracefully: when the subgraph is unreachable it
 * returns a clearly-marked demo dataset (DEMO_MODE) instead of fake data.
 */

export interface PoolInfo {
  id: string;
  token0: { symbol: string; address: string };
  token1: { symbol: string; address: string };
  feeTier: number;
  liquidity: string;
  volumeUSD24h: string;
  feesUSD24h: string;
  tvlUSD: string;
  apr24h: number | null;
}

export interface LiquidityIntelligence {
  pools: PoolInfo[];
  source: "subgraph" | "demo";
  generatedAt: string;
}

const POOL_FRAGMENT = `
  fragment PoolFields on Pool {
    id
    feeTier
    liquidity
    volumeUSD24h: volumeUSD
    feesUSD24h: feesUSD
    tvlUSD: totalValueLockedUSD
    token0 { symbol id }
    token1 { symbol id }
  }
`;

export class PancakeSwapAdapter {
  private readonly chainId: number;

  constructor(chainId = 97) {
    this.chainId = chainId;
  }

  private get subgraphUrl(): string {
    return serverEnv().PANCAKESWAP_SUBGRAPH_URL;
  }

  /** Top pools by liquidity/volume for a pair (or all). */
  async topPools(opts: { limit?: number; orderBy?: "volumeUSD" | "totalValueLockedUSD" } = {}): Promise<LiquidityIntelligence> {
    const limit = opts.limit ?? 10;
    const orderBy = opts.orderBy ?? "totalValueLockedUSD";
    try {
      const query = `
        ${POOL_FRAGMENT}
        query TopPools($limit: Int!, $orderBy: Pool_orderBy!) {
          pools(first: $limit, orderBy: $orderBy, orderDirection: desc, where: { liquidity_gt: 0 }) {
            ...PoolFields
          }
        }
      `;
      const res = await fetch(this.subgraphUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables: { limit, orderBy } }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { pools?: unknown[] } };
      const pools = (json.data?.pools ?? []).map((p) => this.normalizePool(p as Record<string, unknown>));
      return { pools, source: "subgraph", generatedAt: new Date().toISOString() };
    } catch (err) {
      logger.warn({ err }, "pancakeswap subgraph read failed");
      if (serverEnv().DEMO_MODE) {
        return { pools: this.demoPools(), source: "demo", generatedAt: new Date().toISOString() };
      }
      throw new AppError("PCS_UNAVAILABLE", "PancakeSwap data is unavailable right now.", 503);
    }
  }

  /** Pool APR estimate from 24h fees / liquidity (formula documented in docs). */
  async poolApr(poolId: string): Promise<{ apr24h: number | null }> {
    try {
      const query = `
        ${POOL_FRAGMENT}
        query PoolApr($id: ID!) {
          pool(id: $id) { ...PoolFields }
        }
      `;
      const res = await fetch(this.subgraphUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables: { id: poolId } }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { pool?: unknown } };
      const pool = json.data?.pool ? this.normalizePool(json.data.pool as Record<string, unknown>) : null;
      if (!pool) return { apr24h: null };
      const liquidity = BigInt(pool.liquidity || "0");
      if (liquidity === 0n) return { apr24h: null };
      // fees24h ≈ apr on liquidity (rough estimate; exact requires token prices)
      const feesUsd = Number(pool.feesUSD24h ?? 0);
      const tvlUsd = Number(pool.tvlUSD ?? 0);
      const apr24h = tvlUsd > 0 ? (feesUsd / tvlUsd) * 100 : null;
      return { apr24h };
    } catch (err) {
      logger.warn({ err, poolId }, "pancakeswap apr read failed");
      return { apr24h: null };
    }
  }

  /** USDC balance read (used by agents for wallet monitoring use cases). */
  async getTokenBalance(wallet: Address, token: Address): Promise<{ balance: string; decimals: number } | null> {
    try {
      const client = publicClientFor(this.chainId);
      const [balance, decimals] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
        client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { balance: balance.toString(), decimals: Number(decimals) };
    } catch (err) {
      logger.warn({ err, token }, "token balance read failed");
      return null;
    }
  }

  private normalizePool(raw: Record<string, unknown>): PoolInfo {
    const token0 = raw.token0 as Record<string, unknown> | undefined;
    const token1 = raw.token1 as Record<string, unknown> | undefined;
    const apr24h = raw.apr24h != null ? Number(raw.apr24h) : null;
    return {
      id: String(raw.id ?? ""),
      token0: { symbol: String(token0?.symbol ?? "?"), address: String(token0?.id ?? "") },
      token1: { symbol: String(token1?.symbol ?? "?"), address: String(token1?.id ?? "") },
      feeTier: Number(raw.feeTier ?? 0),
      liquidity: String(raw.liquidity ?? "0"),
      volumeUSD24h: String(raw.volumeUSD24h ?? "0"),
      feesUSD24h: String(raw.feesUSD24h ?? "0"),
      tvlUSD: String(raw.tvlUSD ?? "0"),
      apr24h,
    };
  }

  /** Clearly-marked demo dataset used only when DEMO_MODE=true. */
  private demoPools(): PoolInfo[] {
    const usdc = { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" };
    const usdt = { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955" };
    const wbnb = { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" };
    const cake = { symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" };
    const demo = [
      { t0: usdc, t1: usdt, fee: 500, liq: "12000000000000000000000000", vol: "85000000", fees: "42500", tvl: "48000000" },
      { t0: wbnb, t1: usdc, fee: 500, liq: "9000000000000000000000000", vol: "62000000", fees: "31000", tvl: "35000000" },
      { t0: wbnb, t1: usdt, fee: 500, liq: "8800000000000000000000000", vol: "59000000", fees: "29500", tvl: "34000000" },
      { t0: wbnb, t1: cake, fee: 2500, liq: "4100000000000000000000000", vol: "18000000", fees: "4500", tvl: "9000000" },
      { t0: usdc, t1: wbnb, fee: 100, liq: "12000000000000000000000000", vol: "30000000", fees: "3000", tvl: "11000000" },
      { t0: cake, t1: usdc, fee: 2500, liq: "5000000000000000000000000", vol: "15000000", fees: "3750", tvl: "8000000" },
    ];
    return demo.map((p, i) => ({
      id: `demo-pool-${i}`,
      token0: p.t0,
      token1: p.t1,
      feeTier: p.fee,
      liquidity: p.liq,
      volumeUSD24h: p.vol,
      feesUSD24h: p.fees,
      tvlUSD: p.tvl,
      apr24h: (Number(p.fees) / Number(p.tvl)) * 100,
    }));
  }
}

export function getPancakeSwapAdapter(chainId = 97): PancakeSwapAdapter {
  return new PancakeSwapAdapter(chainId);
}

export function pcsSupportedTokens(chainId: number): { symbol: string; address: string }[] {
  const addresses = addressesFor(chainId);
  return [
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955" },
    { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
    { symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" },
    { symbol: "U", address: addresses.paymentToken },
  ];
}
