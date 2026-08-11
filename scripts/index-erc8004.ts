/**
 * ERC-8004 indexer — discovers agents registered on the Identity Registry
 * and indexes their normalized metadata into Supabase (erc8004_agents).
 *
 * Idempotent: every event is anchored by (chain_id, tx_hash, log_index) in
 * indexed_events; re-runs never duplicate records. Registry data is stored
 * verbatim + normalized; marketplace-enriched data lives separately in
 * `agents` and never overwrites on-chain facts.
 *
 * Usage:
 *   npm run index:erc8004 -- --chain 97 --from-block <n> [--watch]
 */
import { ERC8004Adapter, getRegistryTotalAgents } from "../lib/adapters/erc8004";
import { publicClientFor } from "../lib/blockchain/client";
import { addressesFor } from "../lib/blockchain/addresses";
import { getAdminDb } from "../lib/db";
import { serverEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { generateId } from "../lib/auth/crypto";

function parseArgs(argv: string[]): { chainId: number; fromBlock: bigint; watch: boolean; batchSize: number } {
  const args = new Map<string, string>();
  let watch = false;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--watch") { watch = true; continue; }
    const [key, value] = arg.split("=");
    if (key && value) args.set(key.replace(/^--/, ""), value);
  }
  const env = serverEnv();
  return {
    chainId: Number(args.get("chain") ?? "97"),
    fromBlock: BigInt(args.get("from-block") ?? env.ERC8004_INDEX_START_BLOCK),
    watch,
    batchSize: Number(args.get("batch") ?? env.ERC8004_INDEX_BATCH_SIZE),
  };
}

async function runBatch(chainId: number, fromBlock: bigint, batchSize: number): Promise<bigint> {
  const db = getAdminDb();
  const client = publicClientFor(chainId);
  const head = await client.getBlockNumber();
  const toBlock = fromBlock + BigInt(batchSize) > head ? head : fromBlock + BigInt(batchSize);
  if (fromBlock > head) return fromBlock;

  const adapter = new ERC8004Adapter(chainId);
  const events = await adapter.getRegistrationEvents(fromBlock, toBlock);
  logger.info({ chainId, fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), events: events.length }, "erc8004 batch");

  for (const event of events) {
    // Idempotency anchor: skip already-processed events.
    const { data: existing } = await db
      .from("indexed_events")
      .select("transaction_hash")
      .eq("chain_id", chainId)
      .eq("transaction_hash", event.transactionHash)
      .eq("log_index", event.logIndex)
      .maybeSingle();
    if (existing) continue;

    // Resolve identity + registration file.
    const resolved = await adapter.resolveAgent(event.agentId);
    const { data: upserted, error } = await db
      .from("erc8004_agents")
      .upsert({
        chain_id: chainId,
        registry_address: addressesFor(chainId).erc8004Registry,
        agent_id: event.agentId.toString(),
        agent_uri: resolved.identity.agentUri,
        owner_address: resolved.identity.ownerAddress,
        agent_wallet: resolved.identity.agentWallet,
        metadata: resolved.registrationFile ?? null,
        raw_metadata: resolved.rawRegistrationFile ?? null,
        metadata_error: resolved.metadataError,
        indexed_at: resolved.resolvedAt,
        last_checked_at: new Date().toISOString(),
      }, { onConflict: "chain_id,registry_address,agent_id" })
      .select("agent_id");
    if (error) {
      logger.error({ err: error.message, agentId: event.agentId.toString() }, "erc8004 upsert failed");
      continue;
    }

    // Anchor the event (idempotency).
    await db.from("indexed_events").insert({
      chain_id: chainId,
      block_number: Number(event.blockNumber),
      transaction_hash: event.transactionHash,
      log_index: event.logIndex,
      contract_address: addressesFor(chainId).erc8004Registry,
      event_name: "Registered",
      payload: { agentId: event.agentId.toString(), agentUri: event.agentUri, owner: event.owner },
    });
    logger.info({ agentId: event.agentId.toString(), uri: event.agentUri?.slice(0, 60) }, "erc8004 agent indexed");
    void upserted;
    void generateId;
  }

  return toBlock === head ? head + 1n : toBlock + 1n;
}

async function main() {
  const { chainId, fromBlock, watch, batchSize } = parseArgs(process.argv);
  logger.info({ chainId, fromBlock: fromBlock.toString(), watch }, "erc8004 indexer started");
  const total = await getRegistryTotalAgents(chainId).catch(() => 0n);
  logger.info({ totalAgents: total.toString(), registry: addressesFor(chainId).erc8004Registry }, "registry state");

  let cursor = fromBlock;
  do {
    try {
      cursor = await runBatch(chainId, cursor, batchSize);
    } catch (err) {
      logger.error({ err }, "indexer batch failed; retrying in 5s");
      await new Promise((r) => setTimeout(r, 5000));
    }
  } while (watch);
  logger.info("indexer pass complete");
}

main().catch((err) => {
  logger.error({ err }, "indexer crashed");
  process.exit(1);
});
