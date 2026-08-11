# AgentGrid API reference

Base URL: `http://localhost:3000/api` (all routes are server-rendered Next.js
route handlers).

## Conventions

- Success: `200/201` → `{ "data": … }`
- Error: `4xx/5xx` → `{ "error": { "code", "message", "details? } }`
- Auth: `agrid_session` httpOnly cookie; endpoints marked 🔒 require it.
- Common error codes: `VALIDATION_ERROR`, `INVALID_NONCE`, `NONCE_REUSED`,
  `NONCE_EXPIRED`, `INVALID_SIGNATURE`, `AGENT_NOT_FOUND`,
  `AGENT_UNAVAILABLE`, `TRANSACTION_NOT_FOUND`, `HIRE_NOT_FOUND`,
  `SESSION_NOT_FOUND`, `ALTANA_NOT_CONFIGURED`, `PCS_UNAVAILABLE`.

---

## Auth

### POST `/auth/nonce`
Body: `{ "walletAddress": "0x…" }` → `{ "data": { "nonce": "0x…", "expiresAt": "ISO" } }`

### POST `/auth/verify`
Body: `{ "walletAddress", "message", "signature" }` → sets `agrid_session`
cookie; returns `{ "data": { "user": { walletAddress, chainId, avatarSeed, displayName } } }`

### GET `/auth/me` 🔒 → user profile
### POST `/auth/me` 🔒 → logs out (clears cookie)

---

## Agents

### GET `/agents` — search + filter + paginate
Query params:
- `q` text query, `category`, `protocol`, `pricingModel`, `status`,
  `verification`, `minPrice`, `maxPrice`, `minSuccessRate` (0..1)
- `sort`: `relevance` (default) | `trending` | `newest` | `most_hired` |
  `reputation` | `success_rate` | `lowest_price`
- `page` (1-based), `pageSize` (max 50), `newlyListedDays`

→ `{ "data": { agents: Agent[], total, page, pageSize, pages } }`

### POST `/agents` 🔒 — list an agent
Body:
```json
{
  "chainId": 97,
  "name": "YieldGuard",
  "slug": "yield-guard",
  "description": "…",
  "category": "yield",
  "pricingModel": "per_task",
  "price": "1.5",
  "currency": "USDC",
  "capabilities": [{ "capability": "monitoring" }],
  "protocols": [{ "protocol": "pancakeswap", "network": "bnb" }],
  "agentId": "42",              // optional: import from ERC-8004
  "registryAddress": "0x…"      // optional, required with agentId
}
```
With `agentId`+`registryAddress` the service verifies the identity live on the
registry and that the signer is the owner. Otherwise the listing is
`marketplace`/`unverified`.

### GET `/agents/[slug]` — detail (+ records a view)
### GET `/agents/mine` 🔒 — the signer's listings
### GET `/categories` — available categories
### GET `/trending?limit=10` — trending agents (computed scores)
### GET `/overview?window=24h` — ecosystem stats (`15m|30m|1h|24h|7d`)
### GET `/activity?limit=30` — activity feed

---

## ERC-8004

### POST `/erc8004/resolve` — resolve an identity without listing
Body: `{ "chainId": 97, "agentId": "42" }` →
identity (owner, agentWallet, URI), normalized registration file, metadata errors.

### GET `/erc8004/index` — indexer state (counts + latest indexed event)

---

## Hires 🔒

### GET `/hires` — the signer's hires
### POST `/hires` — prepare a hire
Body: `{ "agentId": "agent_…", "task": "…(≥10 chars)", "rail": "native" | "erc8183" }`
→ `{ "data": { hire, tx: { id, state: "awaiting_signature", address, amount, currency, method }, rail } }`

### GET `/hires/[id]` — hire detail
### POST `/hires/[id]/payment` — submit a broadcast native tx
Body: `{ "txId", "txHash" }` → state `submitted`, hire `funding`
### GET `/hires/[id]/payment` — refresh confirmation from the chain
→ `{ txState, hireStatus, confirmed }` — `confirmed: true` only on a successful receipt
### POST `/hires/[id]/erc8183` — fund via ERC-8183 escrow
Body: `{ "txId" }` → `{ jobId, txState: "confirmed" }` (requires Altana config)
### POST `/hires/[id]/execute` — execute the agent task
→ `{ status, resultSummary, resultReference }` (demo runner only in DEMO_MODE)
### POST `/hires/[id]/cancel` — cancel/reject
Body: `{ "state": "cancelled" | "rejected" }`

---

## Sessions 🔒 (Altana on-chain session keys)

### GET `/sessions` — the signer's cached sessions
### POST `/sessions` — grant a scoped session
Body:
```json
{
  "agentId": "agent_…",
  "spendCap": "1000000000000000000",
  "spendToken": "0x…",
  "period": "day",
  "expiryHours": 24,
  "allowedCalls": [{ "to": "0x…", "signature": "transfer(address,uint256)" }]
}
```
→ session with `keyStoreValid` (authoritative on-chain read)

### POST `/sessions/[id]/revoke` — revoke on-chain
### POST `/sessions/[id]/refresh` — re-read KeyStore state

---

## Benchmarks 🔒

### GET `/benchmarks` — Agent Advantage records + summary for the signer
### POST `/benchmarks` — create a manual-vs-agent benchmark record

---

## AI

### POST `/ai/chat`
Body: `{ "messages": [{ "role": "user"|"assistant", "content": "…" }], "context?": { "agentName", "agentSlug" } }`
→ `{ "reply": "…", "toolsUsed": ["searchAgents", …] }`

Tools (read-only): `searchAgents`, `getAgent`, `compareAgents`,
`getTrendingAgents`, `getAgentPerformance`, `getAgentCapabilities`,
`getAgentPermissions`, `getUserHires` 🔒, `getUserSessions` 🔒, `prepareHireInfo`.

---

## PancakeSwap

### GET `/pancakeswap/pools?limit=20&orderBy=liquidity|volumeUSD24h|feesUSD24h|tvlUSD`
→ pools with token symbols, fee tier, liquidity, volume/fees/TVL (24h), APR.
`source: "subgraph"` or `"demo"` (DEMO_MODE fallback, clearly marked).

---

## Users

### GET `/users/me` 🔒 — profile + saved agents + owned agents
