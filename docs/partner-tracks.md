# Partner tracks — implementation status

How AgentGrid maps to the Build the Era partner tracks.

Legend: **Implemented** = live integration via official SDK/API with real
on-chain or API reads; **Partially implemented** = interface + demo/sandbox
path, real path gated on credentials or a follow-up; **Planned** = designed in
the data model but not wired.

## Altana (agent infrastructure)

- **Implemented.** Real on-chain operations through `@altananetwork/sdk`:
  - Session grant with spend cap + call allowlist + expiry, registered in the
    KeyStore (`grantSession` with `register: true`).
  - Revocation (`revokeSession` by public key) and authoritative state reads
    (`isValidKey`/`getKey` on the KeyStore contract).
  - `createAgentWallet` for agent-owned wallets.
  - ERC-8183 hire executed from an Altana session (`hireErc8183Agent`).
- Scope boundary: the session signer is the server operator key
  (`ALTANA_ADMIN_PRIVATE_KEY`); the adapter is signer-agnostic so
  user-owned signers (passkeys) can be injected without code changes.

## ERC-8183 (agentic commerce, escrowed hiring)

- **Implemented.** Buyer-side rail via the official SDK:
  - `POST /api/hires` with `rail: "erc8183"` → operator Altana wallet funds a
    $U job on the AgenticCommerce kernel in one atomic relay intent.
  - `jobId` is the authoritative reference (`result_reference`), with
    `getErc8183Job`/`settleErc8183Job` exposed on the adapter for job reads
    and escrow release/dispute.
  - Deployed addresses (commerce, router, policy, $U) per network from the
    SDK network config; verified for BSC mainnet + testnet.
- Note: seller-side listing of your own ERC-8183 agent is a follow-up.

## x402 / B402 (payments)

- **Partially implemented.** `lib/adapters/payments.ts` defines the
  `PaymentAdapter` interface and `X402PaymentAdapter` (payments
  discovered through HTTP 402 responses, paid via the SDK's
  `payWithX402`/`signX402Payment` primitives). No route currently performs an
  x402 purchase end-to-end — the primary rails (native BNB and ERC-8183
  escrow) are fully wired. The registration-file model records
  `x402Support` for agents, and `paymentRailInfo` reports rail availability.

## PancakeSwap (protocol filter / data)

- **Implemented.** `lib/adapters/pancakeswap.ts`:
  - Top pools by liquidity/volume/fees/TVL (24h) from the official v3
    subgraph, with token symbols and fee tiers.
  - 24h APR estimate per pool (24h fees ÷ TVL).
  - Graceful, clearly-marked demo fallback in `DEMO_MODE` when the subgraph is
    unreachable.
  - `pancakeswap` is a first-class agent `protocol` filter in search.
- Scope boundary: AgentGrid never executes swaps on the user's behalf —
  safe swap execution is a permission-restricted agent action gated by an
  Altana session allowlist (designed, not wired into an agent flow).

## ERC-8004 (agent identity registry)

- **Implemented as reader/import (by design — registration happens on the
  official registry).** See `architecture.md §5`: live identity resolution,
  registration-file normalization, ownership checks at listing time, and an
  idempotent batch indexer over `Registered` events.

## Supabase (infrastructure)

- **Implemented.** Full schema + RLS (`db/migrations/001_core.sql`,
  `002_onchain_index.sql`), service-role server client, wallet-scoped RLS
  context helper, migrations runner (`scripts/migrate.ts`).
- Supabase is explicitly **not** a source of truth for blockchain state —
  it is the marketplace's own data store plus an index/cache of on-chain data.
