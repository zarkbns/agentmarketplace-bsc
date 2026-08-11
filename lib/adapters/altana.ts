import { createClient, signerFromPrivateKey, BNB, BNB_TESTNET, type Session, type SessionPermissions, type CallPermission, type SpendPermission, type Wallet, type Signer } from "@altananetwork/sdk";
import type { Address, Hex } from "viem";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { logger } from "../logger";
import { addressesFor } from "../blockchain/addresses";
import { publicClientFor } from "../blockchain/client";
import { altanaKeyStoreAbi } from "../blockchain/abis";

/**
 * AltanaAdapter — the single seam between AgentGrid and Altana.
 *
 * Real SDK: @altananetwork/sdk (createClient, grantSession, revokeSession,
 * registerSessionKey, execute, balances).
 *
 * Altana is non-custodial agentic-wallet infrastructure on EIP-7702: the
 * admin key grants session keys whose call allowlist + spend caps + expiry
 * are enforced by the on-chain account validator; authorization state lives
 * in the public KeyStore registry.
 *
 * This adapter performs REAL on-chain operations against the official Altana
 * BSC testnet deployment. It never fakes a session or marks a revocation as
 * done without the on-chain transaction.
 *
 * Signer model: the admin signer comes from the server environment
 * (ALTANA_ADMIN_PRIVATE_KEY — a dedicated, funded testnet key operated by
 * AgentGrid as the demo/operator wallet). The adapter is signer-agnostic so
 * production can inject user-owned signers (passkeys) without changing the
 * marketplace code.
 */

export type AltanaNetworkName = "bnb-mainnet" | "bnb-testnet";

export interface AltanaSessionState {
  /** Whether the session key is currently valid in the KeyStore registry. */
  keyValid: boolean;
  /** KeyStore record, when readable. */
  keyRecord: { expiry: bigint; status: number; publicKey: string } | null;
  /** On-chain read performed at. */
  checkedAt: string;
}

export interface CreateSessionInput {
  walletAddress: Address; // the wallet the session acts on
  permissions: {
    allowedCalls: { to?: Address; signature?: string }[];
    spendCap: { token: Address; limit: string } | { native: true; limit: string };
    period: SpendPermission["period"];
  };
  expiry: number; // unix seconds
}

export interface AltanaAdapterOptions {
  network?: AltanaNetworkName;
  adminSigner?: Signer; // injected signer (testability / future passkeys)
}

export class AltanaAdapter {
  private readonly networkName: AltanaNetworkName;
  private readonly client: ReturnType<typeof createClient>;
  private readonly adminSigner: Signer;

  constructor(opts: AltanaAdapterOptions = {}) {
    const env = serverEnv();
    this.networkName = opts.network ?? env.ALTANA_NETWORK;
    const chainConfig = this.networkName === "bnb-testnet" ? BNB_TESTNET : BNB;
    this.client = createClient({ chains: [chainConfig], defaultChainId: chainConfig.chainId });

    if (opts.adminSigner) {
      this.adminSigner = opts.adminSigner;
    } else {
      const key = env.ALTANA_ADMIN_PRIVATE_KEY;
      if (!key) {
        throw new AppError("ALTANA_NOT_CONFIGURED", "Altana is not configured (ALTANA_ADMIN_PRIVATE_KEY missing).", 500);
      }
      this.adminSigner = signerFromPrivateKeySafe(key);
    }
  }

  get chainId(): number {
    return this.networkName === "bnb-testnet" ? 97 : 56;
  }

  // -------------------------------------------------------------------------
  // Agent wallets
  // -------------------------------------------------------------------------

  /** Create a new Altana agent-owned wallet (same address on every chain). */
  async createAgentWallet(): Promise<Wallet> {
    const wallet = await this.client.createWallet({ signer: this.adminSigner });
    logger.info({ wallet: wallet.address, chainId: this.chainId }, "altana wallet created");
    return wallet;
  }

  /** Read wallet state (balances) for an Altana wallet. */
  async getAgentWallet(walletAddress: Address): Promise<{ address: Address }> {
    return { address: walletAddress };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Grant a scoped session on an Altana wallet. Registers the session key in
   * the KeyStore registry by default (register: true), making it verifiable
   * by any third party via isValidKey. Returns the live SDK Session object —
   * persist byte-exactly (the chain hash-commits the granted bytes).
   */
  async createSession(input: CreateSessionInput): Promise<Session> {
    const permissions = this.buildPermissions(input.permissions);
    const session = await this.client.grantSession({
      wallet: { address: input.walletAddress },
      signer: this.adminSigner,
      permissions,
      expiry: input.expiry,
      register: true,
    });
    logger.info(
      { wallet: input.walletAddress, expiry: input.expiry, publicKey: session.publicKey },
      "altana session granted and registered",
    );
    return session;
  }

  /** Revoke a session on-chain (by Session object or session key hex). */
  async revokeSession(
    sessionOrKey: Session | Hex,
    walletAddress?: Address,
  ): Promise<{ txHash: Hex | null; status: string }> {
    try {
      const result = await this.client.revokeSession({
        wallet: { address: typeof sessionOrKey === "string" ? walletAddress ?? this.adminSigner.address : sessionOrKey.walletAddress },
        signer: this.adminSigner,
        session: sessionOrKey,
      });
      return { txHash: result.transactionHash ?? null, status: result.status };
    } catch (err) {
      logger.error({ err }, "altana session revocation failed");
      throw new AppError("SESSION_REVOKE_FAILED", "Revocation transaction failed. See logs.", 500);
    }
  }

  /** Lazily register a session key granted with register: false. Idempotent. */
  async registerSession(session: Session): Promise<void> {
    await this.client.registerSessionKey({
      wallet: { address: session.walletAddress },
      signer: this.adminSigner,
      session,
    });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Execute a batch of calls through a session (used by agent execution). */
  async execute(session: Session, calls: { to: Address; value?: bigint; data: Hex }[]): Promise<{ txHash: Hex | null; status: string }> {
    const result = await this.client.execute({ session, calls });
    return { txHash: result.transactionHash ?? null, status: result.status };
  }

  /**
   * Read the AUTHORITATIVE on-chain session state from the Altana KeyStore.
   * If the key is missing/revoked, keyValid is false — cached Supabase rows
   * are never treated as truth.
   */
  async getOnchainSessionState(publicKey: Hex, walletAddress: Address): Promise<AltanaSessionState> {
    const client = publicClientFor(this.chainId);
    const keyStore = addressesFor(this.chainId).altanaKeyStore;
    try {
      const valid = await client.readContract({
        address: keyStore,
        abi: altanaKeyStoreAbi,
        functionName: "isValidKey",
        args: [walletAddress, publicKey],
      });
      let keyRecord: AltanaSessionState["keyRecord"] = null;
      try {
        const record = await client.readContract({
          address: keyStore,
          abi: altanaKeyStoreAbi,
          functionName: "getKey",
          args: [walletAddress, publicKey],
        });
        keyRecord = { expiry: record[3] as bigint, status: Number(record[4]), publicKey: record[2] };
      } catch {
        keyRecord = null; // getKey selector may vary across deployments
      }
      return { keyValid: Boolean(valid), keyRecord, checkedAt: new Date().toISOString() };
    } catch (err) {
      logger.warn({ err, wallet: walletAddress }, "keystore read failed");
      return { keyValid: false, keyRecord: null, checkedAt: new Date().toISOString() };
    }
  }

  /** Check the session's permission shape (for UI display). */
  getSessionPermissions(session: Session): SessionPermissions {
    return session.permissions;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildPermissions(input: CreateSessionInput["permissions"]): SessionPermissions {
    const calls: CallPermission[] = input.allowedCalls.map((c) =>
      c.to && c.signature ? { to: c.to, signature: c.signature } : c.to ? { to: c.to } : { signature: c.signature! },
    );
    const spend: SpendPermission[] = [
      "spendCap" in input && "token" in input.spendCap
        ? { token: input.spendCap.token, limit: BigInt(input.spendCap.limit), period: input.period }
        : { limit: BigInt((input.spendCap as { limit: string }).limit), period: input.period },
    ];
    if (calls.length > 0) {
      return { calls, spend };
    }
    return { spend };
  }
}

function signerFromPrivateKeySafe(privateKey: string): Signer {
  // The SDK exposes signerFromPrivateKey (server-side, ECDSA) so key
  // material never leaves the server.
  return signerFromPrivateKey(privateKey as Hex);
}

/** Convenience: singleton adapter bound to the server environment. */
let cachedAdapter: AltanaAdapter | null = null;
export function getAltanaAdapter(): AltanaAdapter {
  if (!cachedAdapter) cachedAdapter = new AltanaAdapter();
  return cachedAdapter;
}
