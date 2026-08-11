import type { Address } from "viem";

/**
 * Deployed contract addresses per chain.
 * Sources:
 *  - ERC-8004 Identity Registry + ERC-8183 stack: bnbagent registry /
 *    @altananetwork/sdk ERC8183_ADDRESSES (BSC mainnet 0x8004… vanity prefix).
 *  - Altana KeyStore: @altananetwork/sdk config.ts deployment manifests.
 *
 * These are authoritative on-chain references used only for reads unless a
 * signed transaction path is explicitly built.
 */
export interface ChainAddresses {
  chainId: number;
  /** ERC-8004 Identity Registry (agent identity NFTs + agentWallet). */
  erc8004Registry: Address;
  /** ERC-8183 AgenticCommerce kernel (job escrow). */
  erc8183Commerce: Address;
  /** ERC-8183 EvaluatorRouter. */
  erc8183Router: Address;
  /** ERC-8183 OptimisticPolicy. */
  erc8183Policy: Address;
  /** $U payment token escrowed by the commerce kernel. */
  paymentToken: Address;
  /** Altana KeyStore (on-chain session registry). */
  altanaKeyStore: Address;
  /** Altana KeyStoreController. */
  altanaKeyStoreController: Address;
  explorer: string;
}

export const ADDRESSES: Record<number, ChainAddresses> = {
  56: {
    chainId: 56,
    erc8004Registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    erc8183Commerce: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
    erc8183Router: "0x51895229E12F9876011789B04f8698af06cCD6DA",
    erc8183Policy: "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5",
    paymentToken: "0xcE24439F2D9C6a2289F741120FE202248B666666",
    altanaKeyStore: "0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a",
    altanaKeyStoreController: "0x0834Ee2C9BdC3E3efF0a2dC34393D4B0e546A555",
    explorer: "https://bscscan.com",
  },
  97: {
    chainId: 97,
    erc8004Registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    erc8183Commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
    erc8183Router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
    erc8183Policy: "0x4F4678D4439feC812Ac7674Bb3Efb4C8f5Fb78A6",
    paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
    altanaKeyStore: "0x6b8361C29d05D498b1a12B54A37310f94171E94A",
    altanaKeyStoreController: "0xb530D1971f5453F3359518343F05D0AedFfF7e12",
    explorer: "https://testnet.bscscan.com",
  },
};

export function addressesFor(chainId: number): ChainAddresses {
  const addrs = ADDRESSES[chainId];
  if (!addrs) throw new Error(`No deployed addresses configured for chain ${chainId}.`);
  return addrs;
}
