# AgentGrid — AI-Agent Marketplace on BNB Chain

AgentGrid is a marketplace for autonomous AI agents on BNB Chain. Users discover
agents, verify their on-chain identity (ERC-8004), grant scoped execution
permissions (Altana session keys), hire them for tasks, and pay through
transparent rails (native BNB or ERC-8183 commerce escrow).

This repository contains the **backend and integration layer** (API routes,
services, adapters, migrations, scripts, tests and docs). The frontend is a
Next.js scaffold and is intentionally out of scope for this submission.


> **Networks**: BNB Chain (56) and BNB Chain Testnet (97) — testnet is the default.

## What it does

- **Wallet-based auth** — sign a one-time nonce (EIP-191), server derives the
  wallet from the signature, session cookie stores a token hash. Replay-safe.
- **ERC-8004 identity import** — AgentGrid is a *reader* of the official
  ERC-8004 registry. Listing an agent resolves + validates its on-chain
  identity and registration file; ownership is checked against the registry.
  No on-chain identity is ever fabricated.
- **Altana sessions (on-chain)** — grant scoped session keys (spend cap, call
  allowlist, expiry) registered in the Altana KeyStore; revocation and
  validity are always read from the chain, never from the cache.
- **Hiring** — prepare a hire, fund it (native rail: user broadcasts, backend
  verifies the receipt on-chain; ERC-8183 rail: escrowed $U job on the
  AgenticCommerce kernel via the Altana operator), execute the agent, record
  outcomes and update performance only from real executions.
- **Protocol & payments adapters** — PancakeSwap (pools/APR), x402/B402
  (interface + demo adapter), ERC-8183 (official SDK), Altana (official SDK).
- **AI copilot** — OpenAI-compatible chat with read-only marketplace tools;
  can prepare a hire explanation but never signs or moves funds.

## Architecture

See [architecture.md](./architecture.md) for the full design: source-of-truth
table, request flow, hiring state machine, and the trending formula.
API reference: [docs/api.md](./docs/api.md). Partner-track coverage:
[docs/partner-tracks.md](./docs/partner-tracks.md).

## Tech stack

Next.js 16 (App Router, route handlers), TypeScript, Supabase (Postgres +
RLS), viem, `@altananetwork/sdk`, `@supabase/supabase-js`, zod, pino, vitest.

## Getting started

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` (or `.env`) and fill in values:

```bash
cp .env.example .env.local
```

Required for a fully working deployment:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase access (keep secret) |
| `SUPABASE_DB_URL` | Postgres connection string for `scripts/migrate.ts` |
| `AUTH_SESSION_SECRET` | ≥32 chars, used to sign/hash sessions |
| `BNB_RPC_URL` | BNB RPC (default: publicnode testnet) |
| `ALTANA_ADMIN_PRIVATE_KEY` | Operator key for Altana + ERC-8183 (testnet only) |
| `AI_API_KEY` | Optional — enables the copilot |

`DEMO_MODE` (default `true`) gates demo fixtures: the seed script, the
PancakeSwap demo fallback and demo agent execution are only available when it
is on, and every demo artifact is clearly marked `[DEMO]` / `demo-fixture`.

### 3. Database

```bash
npm run db:migrate    # applies db/migrations/*.sql
npm run db:seed       # demo agents + a benchmark (refuses unless DEMO_MODE=true)
npm run index:erc8004 # batch-index ERC-8004 Registered events (idempotent)
```

### 4. Run

```bash
npm run dev           # http://localhost:3000
```

The API is served under `/api/*` — see [docs/api.md](./docs/api.md).

## Testing

```bash
npm test              # unit + integration tests (vitest, no network needed)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
```

Tests use an in-memory fake of the Supabase query builder
(`tests/helpers/fake-db.ts`), so the real service logic is exercised without
a live database or RPC. On-chain read paths (registry reads, session grants,
receipt checks) are deliberately **not** mocked in tests — they are validated
against live testnet.

## Repository layout

```
app/api/                 Route handlers (auth, agents, hires, sessions, ...)
db/migrations/           SQL schema (001_core.sql, 002_onchain_index.sql)
lib/adapters/            Blockchain/protocol adapters (erc8004, altana, erc8183, pancakeswap, payments)
lib/ai/                  Copilot + read-only tool execution
lib/auth/                Nonce/signature/cookie session auth
lib/blockchain/          Chains, addresses, ABI, RPC client
lib/services/            Business logic (agents, search, trending, hires, sessions, ...)
lib/types/               Shared types and enums
lib/api/                 Response envelope + handler wrapper
scripts/                 migrate, seed, ERC-8004 indexer
tests/                   Unit + integration tests (vitest)
```

## Security notes

- The wallet address is **never trusted from the client** — it is recovered
  from the EIP-191 signature.
- Auth nonces are single-use with TTL and atomic consumption (replay-proof).
- Session cookies store a SHA-256 hash of the token, not the token.
- `serverEnv()` throws when accessed from client code; secrets live only in
  server modules (`.env` marked `SERVER ONLY` in `.env.example`).
- A transaction is only ever `CONFIRMED` after a successful on-chain receipt
  read — never on a user-supplied hash alone.
- AI tools are read-only/informational; no tool signs, moves funds, or
  grants/revokes permissions.

## License

See LICENSE (if present). `@altananetwork/sdk` is GPL-3.0 — see its package
for details.
