import { bsc, bscTestnet, type Chain } from "viem/chains";

export const SUPPORTED_CHAIN_IDS = [56, 97] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const CHAINS: Record<number, Chain> = {
  [bsc.id]: bsc,
  [bscTestnet.id]: bscTestnet,
};

export const chainConfig: Record<number, { chain: Chain; name: string; explorer: string }> = {
  [bsc.id]: {
    chain: bsc,
    name: "BNB Smart Chain",
    explorer: "https://bscscan.com",
  },
  [bscTestnet.id]: {
    chain: bscTestnet,
    name: "BNB Smart Chain Testnet",
    explorer: "https://testnet.bscscan.com",
  },
};

export const DEFAULT_CHAIN_ID = 97; // testnet for development
