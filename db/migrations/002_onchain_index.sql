-- AgentGrid — migration 002: on-chain index + Altana sessions
-- Caches of blockchain state. The blockchain remains authoritative; these
-- tables exist for fast querying and are refreshed by the indexer.

begin;

-- ---------------------------------------------------------------------------
-- Indexed events — idempotency anchor for the indexer
-- ---------------------------------------------------------------------------

create table if not exists indexed_events (
  chain_id integer not null,
  block_number bigint not null,
  transaction_hash text not null,
  log_index integer not null,
  contract_address text not null,
  event_name text not null,
  payload jsonb,
  processed_at timestamptz not null default now(),
  primary key (chain_id, transaction_hash, log_index)
);

-- ---------------------------------------------------------------------------
-- ERC-8004 on-chain agent index (authoritative identity data, read-only)
-- ---------------------------------------------------------------------------

create table if not exists erc8004_agents (
  chain_id integer not null,
  registry_address text not null,
  agent_id text not null,            -- ERC-8004 tokenId (stringified uint256)
  agent_uri text,                    -- original agentURI
  owner_address text,                -- ownerOf(agentId) — on-chain truth
  agent_wallet text,                 -- getAgentWallet(agentId) — signing/payment address
  metadata jsonb,                    -- normalized registration file
  raw_metadata jsonb,                -- original registration file, verbatim
  metadata_error text,
  indexed_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  primary key (chain_id, registry_address, agent_id)
);

create index if not exists erc8004_agents_owner_idx on erc8004_agents (owner_address);
create index if not exists erc8004_agents_agent_wallet_idx on erc8004_agents (agent_wallet);
create index if not exists erc8004_agents_indexed_at_idx on erc8004_agents (indexed_at desc);

-- ---------------------------------------------------------------------------
-- Altana session cache. Authoritative state lives in the Altana KeyStore /
-- account validator on-chain; this table indexes it for the UI.
-- ---------------------------------------------------------------------------

create table if not exists altana_sessions (
  id text primary key,
  user_wallet text not null,         -- wallet that granted the session
  agent_id text references agents (id) on delete set null,
  chain_id integer not null default 97,
  wallet_address text not null,      -- Altana wallet the session acts on
  agent_address text,                -- session's wallet/account address
  session_id text,                   -- keystore key id (bytes32 hex)
  session_key text,                  -- session public key (hex)
  spend_cap text,                    -- raw token units (stringified bigint)
  spend_token text,
  spend_period text,                 -- minute|hour|day|week|month|year
  allowed_calls jsonb,               -- [{to?, signature?}]
  expiry timestamptz,
  registration_tx text,
  revocation_tx text,
  status session_status not null default 'pending',
  spent_so_far text,                 -- cached from on-chain reads
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists altana_sessions_user_idx on altana_sessions (user_wallet, status);
create index if not exists altana_sessions_agent_idx on altana_sessions (agent_id);
create index if not exists altana_sessions_wallet_idx on altana_sessions (wallet_address);

commit;
