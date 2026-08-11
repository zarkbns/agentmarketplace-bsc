# AgentGrid — Architecture

## 1. System overview

AgentGrid is a server-rendered Next.js app whose backend exposes a REST API.
The browser never talks to Supabase or the chain directly; every read/write
goes through route handlers backed by typed services.

```
┌────────────┐  HTTPS   ┌──────────────────────────────────────────────┐
│   Wallet    │─────────▶│                Next.js (server)              │
│  (viem/wagmi)│  sign   │  ┌────────────────────────────────────────┐  │
└────────────┘          │  │ Route handlers  /api/*                  │  │
                        │  └───────────────┬────────────────────────┘  │
                        │                  │                           │
                        │   ┌──────────────▼───────────────┐          │
                        │   │ Services (auth, agents,      │          │
                        │   │ hires, sessions, search,     │          │
                        │   │ trending, activity, ...)     │          │
                        │   └───┬───────────────┬──────────┘          │
                        │       │               │                      │
                        │  ┌────▼────┐    ┌─────▼──────┐    ┌─────────┐│
                        │  │ Supabase│    │ Adapters   │    │   AI    ││
                        │  │ (cache/ │    │ erc8004    │    │ copilot ││
                        │  │ index + │    │ altana     │    │ + tools ││
                        │  │ RLS)    │    │ erc8183    │    └─────────┘│
                        │  └─────────┘    │ pancakeswap│               │
                        │                 │ payments   │               │
                        │                 └─────┬──────┘               │
                        └───────────────────────┼──────────────────────┘
                                                │ RPC (viem)
                                    ┌───────────▼────────────┐
                                    │  BNB Chain (56 / 97)   │
                                    │  ERC-8004 registry     │
                                    │  Altana KeyStore       │
                                    │  AgenticCommerce (8183)│
                                    │  PancakeSwap subgraph  │
                                    └────────────────────────┘
```

## 2. Source of truth

| Data | Authoritative source | Supabase role |
| --- | --- | --- |
| Agent identity, owner, metadata URI | ERC-8004 Identity Registry (on-chain) | Indexed copy (`erc8004_agents`) + imported `agents` rows |
| Session validity, expiry, revocation | Altana KeyStore (on-chain `isValidKey`) | Cache (`altana_sessions`) — refreshed from chain |
| Payment / hire confirmation | Transaction receipt (on-chain) | `transactions` / `hires` status mirror |
| ERC-8183 job state | AgenticCommerce kernel | `result_reference = erc8183:job:<id>` |
| Marketplace profile, pricing, search, trending | Supabase | Primary store (marketplace data) |
| Performance (tasks, success rate) | Real hire executions only | `agent_performance` |
| PancakeSwap pools/APR | v3 subgraph | None (live read; demo fallback flagged) |

Rule: **the chain is authoritative for everything on-chain**. Supabase rows are
mirrors; cached session state is refreshed by re-reading the KeyStore before
display/action decisions, and a hire is never `CONFIRMED` without a receipt.

## 3. Request flow

Every route handler is wrapped by `lib/api/response.ts` `handle()`:

```
Request → parseQuery/parseBody (zod) → service → { data, error, meta }
```

- Success: `{ data, meta? }` with `200/201`.
- Failure: `{ error: { code, message, details? } }`; `AppError` carries a
  stable machine-readable `code` (e.g. `NONCE_REUSED`, `AGENT_NOT_FOUND`).
- Unexpected errors are logged (pino) and returned as `INTERNAL_ERROR` —
  stack traces never reach the client.

## 4. Authentication

```
POST /api/auth/nonce        { walletAddress }        → { nonce }  (TTL, single-use)
POST /api/auth/verify       { walletAddress, message, signature } → session cookie
GET  /api/auth/me           → user (or 401)
POST /api/auth/me           → logout
```

1. Server issues a random 64-hex nonce stored in `auth_nonces` (TTL default 5 min).
2. Client signs `buildAuthMessage(nonce)` with `personal_sign` (EIP-191).
3. Verify: consumes the nonce **atomically** (compare-and-swap on
   `consumed_at = null`), then `verifyMessage` recovers the signer and checks
   it against the claimed address. The wallet is derived from the signature —
   never accepted from the client.
4. On success, a random token is hashed (SHA-256) and stored in
   `auth_sessions`; the raw token goes to an `httpOnly` cookie
   (`agrid_session`, secure in production).
5. `requireAuth()` resolves the cookie → token hash → wallet.

Replay of a captured nonce+signature fails (`NONCE_REUSED`).

## 5. ERC-8004 identity (read-only)

AgentGrid is **not a registration client** — agents register on the official
ERC-8004 registry and AgentGrid lists them. The flow:

```
POST /api/erc8004/resolve { chainId, agentId }
  → resolveIdentity(agentId)      tokenURI + ownerOf + getAgentWallet (live)
  → fetchRegistrationFile(uri)    https / ipfs:// / data: URIs
  → normalizeRegistrationFile()   canonical RegistrationFile shape

POST /api/agents (with agentId + registryAddress)
  → validateOnchainIdentity()     registry must be the official one for the chain;
                                  owner must equal the claiming wallet (403 otherwise)
  → createAgent()                 registration_source = 'erc8004_registry',
                                  verification_status = 'registry_verified'
```

Marketplace-only listings (`registration_source = 'marketplace'`,
`verification_status = 'unverified'`) are explicit: no on-chain identity is
claimed or fabricated.

The batch indexer (`scripts/index-erc8004.ts`) replays `Registered` events
into `indexed_events` (idempotency key: `(chain_id, tx_hash, log_index)`) and
upserts `erc8004_agents`.

## 6. Altana sessions (on-chain permissions)

Hiring an agent can include granting a **scoped session key**:

```
POST /api/sessions   { agentId, spendCap, spendToken, period, expiryHours, allowedCalls }
  → createAgentWallet()              (or reuse the agent's wallet)
  → grantSession(register: true)     spend cap + call allowlist + expiry
  → getOnchainSessionState(publicKey, wallet)   → keyValid from KeyStore
  → cache row in altana_sessions

POST /api/sessions/[id]/revoke       real on-chain revokeSession, then re-read state
GET  /api/sessions/[id]/refresh      re-read KeyStore; cache is never truth
```

The KeyStore `isValidKey(wallet, key)` read decides `active` vs `revoked`;
expiry is enforced on-chain by the account contract. The Supabase row only
mirrors chain state for UI convenience.

## 7. Hiring & the transaction state machine

Hiring flow: **Discover → View → Configure task → Review price → [Permissions
if required] → Wallet authorization → On-chain transaction → Execution →
Result**.

### State machine (`lib/services/transactions.ts`)

```
CREATED → AWAITING_SIGNATURE → SUBMITTED → PENDING → CONFIRMED
                                      │        └─→ FAILED
                                      └─→ REJECTED / CANCELLED
(any pre-submission state) → EXPIRED
```

- `assertTransition` guards every DB write; illegal jumps throw.
- `CONFIRMED` is reachable **only** via `refreshHireConfirmation`, which reads
  the receipt (`getTransactionReceipt`) and requires `status === 'success'`.
- `REJECTED`/`FAILED` allow retry (`→ SUBMITTED`); `CONFIRMED` is terminal.

### Payment rails

| Rail | Flow | Confirmation |
| --- | --- | --- |
| `native` | User signs + broadcasts transfer; submits tx hash via `POST /api/hires/[id]/payment` | Backend reads receipt on-chain; only then `PENDING → CONFIRMED` |
| `erc8183` | Operator Altana wallet creates session, `hireErc8183Agent` funds a $U job on AgenticCommerce in one atomic relay intent | `jobId` recorded; job state is authoritative on the kernel |

`executeHire` calls the agent's published endpoint (real execution updates
`agent_performance`). Without an endpoint it runs **only** in `DEMO_MODE`,
producing a clearly-marked `[DEMO]` result and never touching performance data.

## 8. Trending

Trending scores use a linear time decay over a rolling window
(`TRENDING_WINDOW_HOURS`, default 7d):

```
decay(event, windowHours) = max(0, 1 − age_hours / windowHours)

score = wHires·Σdecay(hires) + wTasks·Σdecay(task_completed)
      + wViews·Σdecay(views) + wExecutions·Σdecay(executions)
      + wActivity·Σdecay(other activity)
```

Weights (env-configurable): hires 3, tasks 2, views 1, executions 2, activity 1.
A fresh hire weighs 3× a fresh view; events older than the window contribute 0.

## 9. Data model

`db/migrations/001_core.sql` — `users`, `auth_nonces`, `auth_sessions`,
`agents`, `agent_capabilities`, `agent_protocols`, `agent_performance`,
`activity`, `agent_views`, `hires`, `transactions`, `saved_agents`,
`user_preferences`, `ai_conversations`, `agent_advantage`. All tables carry
RLS policies; `app_wallet()` reads `current_setting('app.wallet_address')`.

`db/migrations/002_onchain_index.sql` — `indexed_events`, `erc8004_agents`,
`altana_sessions`.

## 10. AI copilot boundary

`POST /api/ai/chat` runs an OpenAI-compatible chat loop with 10 backend tools
(search, get, compare, trending, performance, capabilities, permissions,
user hires/sessions, hire info). **All tools are read-only.** The system
prompt instructs the model that it prepares hire explanations but never signs,
moves funds, or grants/revokes permissions — the user's wallet remains the
final authorization layer.

## 11. Testing strategy

- **Unit** (`tests/unit`): pure logic — signature verification (viem local
  accounts), validation, relevance/sort/filter, trending decay & weights,
  tx state machine, registration-file normalization, Agent Advantage math.
- **Integration** (`tests/integration`): services against
  `tests/helpers/fake-db.ts` (an in-memory Supabase subset) — nonce
  create/consume/replay, marketplace listing, hire prepare/cancel/submit,
  ownership checks. `vi.mock("../../lib/db")` injects the fake.
- On-chain paths are intentionally **not** mocked; they're validated against
  live testnet (registry reads, KeyStore, receipts).

## 12. Deployment notes

- Secrets: see `.env.example` (`SERVER ONLY` sections). `serverEnv()` throws
  on the client.
- Run migrations via `npm run db:migrate` (needs `SUPABASE_DB_URL`).
- Run the indexer on a schedule or in `--watch` mode
  (`npm run index:erc8004 -- --watch`).
- `DEMO_MODE` must be **off** in production; demo fixtures refuse to seed and
  demo executions are disabled.
