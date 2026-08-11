-- AgentGrid — migration 001: core marketplace schema
-- Application database (Supabase/Postgres). The blockchain remains the
-- source of truth for on-chain facts; these tables cache/index them.

begin;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type agent_category as enum (
  'monitoring', 'trading', 'yield', 'research', 'security', 'defi',
  'portfolio', 'automation'
);

create type agent_status as enum ('active', 'paused', 'deprecated');

create type pricing_model as enum ('per_task', 'per_call', 'per_execution', 'subscription');

create type verification_status as enum ('unverified', 'registry_verified', 'marketplace_verified');

create type registration_source as enum ('erc8004_registry', 'marketplace');

create type hire_status as enum (
  'preparing', 'awaiting_signature', 'funding', 'active',
  'completed', 'failed', 'cancelled', 'refunded'
);

create type tx_state as enum (
  'created', 'awaiting_signature', 'submitted', 'pending', 'confirmed',
  'rejected', 'failed', 'expired', 'cancelled'
);

create type tx_kind as enum ('payment', 'session_grant', 'session_revoke', 'erc8183_hire', 'execution');

create type session_status as enum ('pending', 'active', 'expired', 'revoked');

create type activity_type as enum (
  'new_listing', 'hire', 'task_completed', 'task_failed',
  'transaction', 'reputation_update', 'agent_interaction'
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

create table if not exists users (
  id text primary key,
  wallet_address text not null,
  chain integer not null default 97,
  avatar_seed text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_wallet_address_idx on users (wallet_address);
create index if not exists users_created_at_idx on users (created_at desc);

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------

create table if not exists auth_nonces (
  id text primary key,
  wallet_address text not null,
  nonce text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists auth_nonces_nonce_idx on auth_nonces (nonce);
create index if not exists auth_nonces_wallet_idx on auth_nonces (wallet_address);

create table if not exists auth_sessions (
  id text primary key,
  wallet_address text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists auth_sessions_token_hash_idx on auth_sessions (token_hash);
create index if not exists auth_sessions_wallet_idx on auth_sessions (wallet_address);
create index if not exists auth_sessions_expires_idx on auth_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Agents (marketplace records — enriched, indexed view of agents)
-- ---------------------------------------------------------------------------

create table if not exists agents (
  id text primary key,
  -- On-chain identity (ERC-8004). These reference blockchain state; the
  -- authoritative values are read from the registry, not invented here.
  onchain_agent_id text,             -- ERC-8004 agentId (stringified uint256)
  registry_address text,             -- identity registry address on that chain
  owner_wallet text,                 -- agent owner (registry ownerOf, or lister)
  -- Marketplace data
  name text not null,
  slug text not null,
  description text,
  category agent_category not null default 'automation',
  status agent_status not null default 'active',
  pricing_model pricing_model not null default 'per_task',
  price text not null default '0',   -- stringified decimal (safe bigint math)
  currency text not null default 'USDC',
  endpoint text,
  metadata_uri text,                 -- original registration file URI
  image_uri text,
  verification_status verification_status not null default 'unverified',
  registration_source registration_source not null default 'erc8004_registry',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- On-chain identity uniqueness: an agent id from a registry is unique.
create unique index if not exists agents_onchain_identity_idx
  on agents (registry_address, onchain_agent_id) where onchain_agent_id is not null;

create unique index if not exists agents_slug_idx on agents (slug);
create index if not exists agents_category_idx on agents (category);
create index if not exists agents_status_idx on agents (status);
create index if not exists agents_owner_wallet_idx on agents (owner_wallet);
create index if not exists agents_created_at_idx on agents (created_at desc);
create index if not exists agents_pricing_model_idx on agents (pricing_model);

-- ---------------------------------------------------------------------------
-- Agent capabilities
-- ---------------------------------------------------------------------------

create table if not exists agent_capabilities (
  id text primary key,
  agent_id text not null references agents (id) on delete cascade,
  capability text not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists agent_capabilities_agent_idx on agent_capabilities (agent_id);
create index if not exists agent_capabilities_capability_idx on agent_capabilities (capability);

-- ---------------------------------------------------------------------------
-- Agent protocols / ecosystems
-- ---------------------------------------------------------------------------

create table if not exists agent_protocols (
  agent_id text not null references agents (id) on delete cascade,
  protocol text not null,            -- e.g. pancakeswap, venus, aave, lista, bnb-chain
  network text not null default 'bsc-mainnet',
  created_at timestamptz not null default now(),
  primary key (agent_id, protocol)
);

create index if not exists agent_protocols_protocol_idx on agent_protocols (protocol);

-- ---------------------------------------------------------------------------
-- Agent performance — ONLY real, verified execution metrics. No invented data.
-- ---------------------------------------------------------------------------

create table if not exists agent_performance (
  agent_id text primary key references agents (id) on delete cascade,
  success_rate numeric(6,5),         -- 0..1
  tasks_completed integer not null default 0,
  average_execution_time_seconds numeric,
  average_cost numeric,
  currency text not null default 'USDC',
  evaluation_window_days integer,
  risk_metrics jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists agent_performance_success_rate_idx on agent_performance (success_rate desc);

-- ---------------------------------------------------------------------------
-- Marketplace activity feed
-- ---------------------------------------------------------------------------

create table if not exists activity (
  id text primary key,
  type activity_type not null,
  agent_id text references agents (id) on delete set null,
  user_wallet text,
  transaction_hash text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_created_at_idx on activity (created_at desc);
create index if not exists activity_type_idx on activity (type);
create index if not exists activity_agent_idx on activity (agent_id);
create index if not exists activity_agent_created_idx on activity (agent_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Agent views / activity counter (for trending)
-- ---------------------------------------------------------------------------

create table if not exists agent_views (
  agent_id text not null references agents (id) on delete cascade,
  viewer_wallet text,
  viewed_at timestamptz not null default now()
);

create index if not exists agent_views_agent_created_idx on agent_views (agent_id, viewed_at desc);

-- ---------------------------------------------------------------------------
-- Hires
-- ---------------------------------------------------------------------------

create table if not exists hires (
  id text primary key,
  user_wallet text not null,
  agent_id text not null references agents (id) on delete restrict,
  task text not null,
  status hire_status not null default 'preparing',
  price text not null,
  currency text not null default 'USDC',
  transaction_hash text,
  chain_id integer not null default 97,
  started_at timestamptz,
  completed_at timestamptz,
  result_reference text,             -- URI/hash of the delivered result
  result_summary text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists hires_user_wallet_idx on hires (user_wallet, created_at desc);
create index if not exists hires_agent_idx on hires (agent_id, created_at desc);
create index if not exists hires_status_idx on hires (status);
create index if not exists hires_created_at_idx on hires (created_at desc);

-- ---------------------------------------------------------------------------
-- Transactions — consistent lifecycle state machine.
-- Never assume a submitted transaction succeeded; states are updated from
-- on-chain confirmation only.
-- ---------------------------------------------------------------------------

create table if not exists transactions (
  id text primary key,
  hire_id text references hires (id) on delete set null,
  user_wallet text not null,
  chain_id integer not null default 97,
  kind tx_kind not null default 'payment',
  state tx_state not null default 'created',
  tx_hash text,
  contract_address text,
  method text,
  payload jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transactions_user_idx on transactions (user_wallet, created_at desc);
create index if not exists transactions_hire_idx on transactions (hire_id);
create index if not exists transactions_state_idx on transactions (state);
create index if not exists transactions_tx_hash_idx on transactions (tx_hash);

-- ---------------------------------------------------------------------------
-- Saved agents
-- ---------------------------------------------------------------------------

create table if not exists saved_agents (
  user_wallet text not null,
  agent_id text not null references agents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_wallet, agent_id)
);

-- ---------------------------------------------------------------------------
-- User preferences (minimal)
-- ---------------------------------------------------------------------------

create table if not exists user_preferences (
  user_wallet text primary key,
  chain integer not null default 97,
  default_currency text not null default 'USDC',
  ai_tone text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI conversation metadata (not full transcripts)
-- ---------------------------------------------------------------------------

create table if not exists ai_conversations (
  id text primary key,
  user_wallet text not null,
  context_agent_id text references agents (id) on delete set null,
  message_count integer not null default 0,
  last_question text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_conversations_user_idx on ai_conversations (user_wallet, updated_at desc);

-- ---------------------------------------------------------------------------
-- Agent Advantage (TermiX track): manual vs agent benchmarks
-- ---------------------------------------------------------------------------

create table if not exists agent_advantage (
  id text primary key,
  agent_id text not null references agents (id) on delete cascade,
  task_description text not null,
  benchmark_type text not null default 'manual_vs_agent',
  agent_execution_time_seconds numeric,
  manual_execution_time_seconds numeric,
  agent_cost numeric,
  manual_cost numeric,
  agent_output text,
  manual_output text,
  agent_quality_score numeric,        -- 0..10
  manual_quality_score numeric,       -- 0..10
  evaluation_notes text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists agent_advantage_agent_idx on agent_advantage (agent_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS uses a Postgres runtime setting (app.wallet_address) as identity so it
-- can key off AgentGrid's wallet auth (not Supabase Auth). The backend sets
-- this setting per request (direct SQL / RPC path) or uses the service role
-- for server-side operations; the anon key path is denied by default.

alter table users enable row level security;
alter table auth_nonces enable row level security;
alter table auth_sessions enable row level security;
alter table agents enable row level security;
alter table agent_capabilities enable row level security;
alter table agent_protocols enable row level security;
alter table agent_performance enable row level security;
alter table activity enable row level security;
alter table agent_views enable row level security;
alter table hires enable row level security;
alter table transactions enable row level security;
alter table saved_agents enable row level security;
alter table user_preferences enable row level security;
alter table ai_conversations enable row level security;
alter table agent_advantage enable row level security;

-- helper: the current wallet from the runtime setting (lowercased)
create or replace function app_wallet() returns text
language sql stable as $$
  select nullif(current_setting('app.wallet_address', true), '')
$$;

-- Marketplace data is publicly readable
create policy "agents readable by all" on agents for select using (true);
create policy "agent capabilities readable by all" on agent_capabilities for select using (true);
create policy "agent protocols readable by all" on agent_protocols for select using (true);
create policy "agent performance readable by all" on agent_performance for select using (true);
create policy "activity readable by all" on activity for select using (true);
create policy "agent advantage readable by all" on agent_advantage for select using (true);

-- Writes are restricted to the authenticated wallet
create policy "users own their profile" on users
  for all using (wallet_address = app_wallet()) with check (wallet_address = app_wallet());
create policy "nonces own their rows" on auth_nonces
  for all using (wallet_address = app_wallet()) with check (wallet_address = app_wallet());
create policy "sessions own their rows" on auth_sessions
  for all using (wallet_address = app_wallet()) with check (wallet_address = app_wallet());
create policy "owners list agents" on agents
  for insert with check (owner_wallet = app_wallet());
create policy "owners update agents" on agents
  for update using (owner_wallet = app_wallet()) with check (owner_wallet = app_wallet());
create policy "hires owned by wallet" on hires
  for all using (user_wallet = app_wallet()) with check (user_wallet = app_wallet());
create policy "transactions owned by wallet" on transactions
  for all using (user_wallet = app_wallet()) with check (user_wallet = app_wallet());
create policy "views can be inserted by anyone" on agent_views for insert with check (true);
create policy "saved agents owned by wallet" on saved_agents
  for all using (user_wallet = app_wallet()) with check (user_wallet = app_wallet());
create policy "preferences owned by wallet" on user_preferences
  for all using (user_wallet = app_wallet()) with check (user_wallet = app_wallet());
create policy "conversations owned by wallet" on ai_conversations
  for all using (user_wallet = app_wallet()) with check (user_wallet = app_wallet());

commit;
