/**
 * Canonical shared types for AgentGrid.
 * Used by the API layer, services and the frontend. Do not redefine these
 * types in individual components.
 */

import type { Address, Hex } from "viem";

// ---------------------------------------------------------------------------
// Enum-ish string unions
// ---------------------------------------------------------------------------

export const AGENT_CATEGORIES = [
  "monitoring",
  "trading",
  "yield",
  "research",
  "security",
  "defi",
  "portfolio",
  "automation",
] as const;
export type AgentCategory = (typeof AGENT_CATEGORIES)[number];

export const AGENT_STATUSES = ["active", "paused", "deprecated"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const PRICING_MODELS = [
  "per_task",
  "per_call",
  "per_execution",
  "subscription",
] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const AGENT_VERIFICATION_STATUSES = [
  "unverified",
  "registry_verified", // on-chain ERC-8004 registration found and verified
  "marketplace_verified", // manually verified by AgentGrid
] as const;
export type AgentVerificationStatus = (typeof AGENT_VERIFICATION_STATUSES)[number];

export const HIRE_STATUSES = [
  "preparing",
  "awaiting_signature",
  "funding",
  "active",
  "completed",
  "failed",
  "cancelled",
  "refunded",
] as const;
export type HireStatus = (typeof HIRE_STATUSES)[number];

export const TX_STATES = [
  "created",
  "awaiting_signature",
  "submitted",
  "pending",
  "confirmed",
  "rejected",
  "failed",
  "expired",
  "cancelled",
] as const;
export type TxState = (typeof TX_STATES)[number];

export const SESSION_STATUSES = ["active", "expired", "revoked", "pending"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ACTIVITY_TYPES = [
  "new_listing",
  "hire",
  "task_completed",
  "task_failed",
  "transaction",
  "reputation_update",
  "agent_interaction",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const PROTOCOLS = [
  "bnb-chain",
  "pancakeswap",
  "venus",
  "aave",
  "lista",
  "altana",
] as const;
export type ProtocolId = (typeof PROTOCOLS)[number];

export const NETWORKS = ["bsc-mainnet", "bsc-testnet", "ethereum"] as const;
export type Network = (typeof NETWORKS)[number];

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  wallet_address: Address;
  chain: number;
  avatar_seed: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentCapability {
  id: string;
  agent_id: string;
  capability: string;
  description: string | null;
}

export interface AgentProtocol {
  agent_id: string;
  protocol: ProtocolId;
  network: Network;
}

export interface AgentPerformance {
  agent_id: string;
  success_rate: number | null; // 0..1
  tasks_completed: number;
  average_execution_time_seconds: number | null;
  average_cost: number | null; // in `currency`
  currency: string;
  evaluation_window_days: number | null;
  risk_metrics: Record<string, unknown> | null;
  updated_at: string;
}

export interface AgentOnchainRef {
  chain_id: number;
  registry_address: Address;
  agent_id: string; // ERC-8004 agentId (tokenId) as decimal string
  agent_uri: string | null;
  owner_address: Address | null;
  agent_wallet: Address | null;
  verified_at: string | null;
}

/** Marketplace record (enriched view). On-chain facts live in AgentOnchainRef. */
export interface Agent {
  id: string;
  onchain_agent_id: string | null; // ERC-8004 agentId (stringified uint256)
  registry_address: Address | null;
  owner_wallet: Address | null;
  name: string;
  slug: string;
  description: string | null;
  category: AgentCategory;
  status: AgentStatus;
  pricing_model: PricingModel;
  price: string; // stringified decimal for safe arithmetic in the browser
  currency: string;
  endpoint: string | null;
  metadata_uri: string | null;
  image_uri: string | null;
  verification_status: AgentVerificationStatus;
  registration_source: "erc8004_registry" | "marketplace";
  created_at: string;
  updated_at: string;
  // Joined/nested data
  capabilities: AgentCapability[];
  protocols: AgentProtocol[];
  performance: AgentPerformance | null;
  onchain: AgentOnchainRef | null;
  hire_count: number;
  trending_score: number;
}

// ---------------------------------------------------------------------------
// Hires & transactions
// ---------------------------------------------------------------------------

export interface Hire {
  id: string;
  user_wallet: Address;
  agent_id: string;
  task: string;
  status: HireStatus;
  price: string;
  currency: string;
  transaction_hash: Hex | null;
  chain_id: number;
  started_at: string | null;
  completed_at: string | null;
  result_reference: string | null;
  result_summary: string | null;
  error: string | null;
  created_at: string;
}

export interface TxRecord {
  id: string;
  hire_id: string | null;
  user_wallet: Address;
  chain_id: number;
  kind: "payment" | "session_grant" | "session_revoke" | "erc8183_hire" | "execution";
  state: TxState;
  tx_hash: Hex | null;
  contract_address: Address | null;
  method: string | null;
  payload: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Altana sessions
// ---------------------------------------------------------------------------

export interface SessionPermissionCall {
  to?: Address;
  signature?: string;
}

export interface SessionPermissionSpend {
  token?: Address;
  period: "minute" | "hour" | "day" | "week" | "month" | "year";
  limit: string; // stringified bigint (raw token units)
}

export interface AgentSession {
  id: string;
  user_wallet: Address;
  agent_id: string;
  session_id: string | null; // public key / keystore identifier
  wallet_address: Address;
  agent_address: Address | null;
  session_key: Hex | null;
  spend_cap: string | null;
  spend_token: Address | null;
  allowed_calls: SessionPermissionCall[] | null;
  expiry: string | null; // ISO timestamp
  registration_tx: Hex | null;
  revocation_tx: Hex | null;
  chain_id: number;
  status: SessionStatus;
  spent_so_far: string | null; // cached on-chain reads
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// TermiX — Agent Advantage
// ---------------------------------------------------------------------------

export interface AgentAdvantage {
  id: string;
  agent_id: string;
  task_description: string;
  benchmark_type: "manual_vs_agent";
  agent_execution_time_seconds: number | null;
  manual_execution_time_seconds: number | null;
  agent_cost: number | null;
  manual_cost: number | null;
  agent_output: string | null;
  manual_output: string | null;
  agent_quality_score: number | null; // 0..10
  manual_quality_score: number | null; // 0..10
  evaluation_notes: string | null;
  verified: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Activity & trending
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  agent_id: string | null;
  user_wallet: string | null;
  transaction_hash: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface TrendingScore {
  agent_id: string;
  score: number;
  signals: {
    recent_hires: number;
    recent_tasks: number;
    recent_views: number;
    recent_executions: number;
    recent_activity: number;
  };
}

// ---------------------------------------------------------------------------
// Overview / ecosystem intelligence
// ---------------------------------------------------------------------------

export interface OverviewStats {
  active_agents: number;
  total_hires: number;
  tasks_completed: number;
  agent_transactions: number;
  new_agents_7d: number;
  trending_agents: Agent[];
  popular_categories: { category: AgentCategory; count: number }[];
  popular_protocols: { protocol: ProtocolId; count: number }[];
  recent_activity: ActivityEvent[];
}
