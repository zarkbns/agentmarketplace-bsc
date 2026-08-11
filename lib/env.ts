import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().default(97),
  NEXT_PUBLIC_RPC_URL: z.string().url().default("https://bsc-testnet-rpc.publicnode.com"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),

  AUTH_SESSION_SECRET: z.string().min(32).optional(),
  AUTH_NONCE_TTL_SECONDS: z.coerce.number().int().default(300),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().default(60 * 60 * 24 * 7),
  AUTH_COOKIE_NAME: z.string().default("agrid_session"),
  AUTH_COOKIE_SECURE: z.coerce.boolean().default(true),

  BNB_RPC_URL: z.string().url().default("https://bsc-testnet-rpc.publicnode.com"),

  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_API_KEY: z.string().optional(),
  AI_SYSTEM_PROMPT: z.string().optional(),

  ALTANA_NETWORK: z.enum(["bnb-mainnet", "bnb-testnet"]).default("bnb-testnet"),
  ALTANA_ADMIN_PRIVATE_KEY: z.string().optional(),

  ERC8004_INDEX_START_BLOCK: z.coerce.number().int().default(0),
  ERC8004_INDEX_BATCH_SIZE: z.coerce.number().int().default(2000),

  TRENDING_W_HIRES: z.coerce.number().default(3),
  TRENDING_W_TASKS: z.coerce.number().default(2),
  TRENDING_W_VIEWS: z.coerce.number().default(1),
  TRENDING_W_EXECUTIONS: z.coerce.number().default(2),
  TRENDING_W_ACTIVITY: z.coerce.number().default(1),
  TRENDING_WINDOW_HOURS: z.coerce.number().default(24 * 7),

  DEMO_MODE: z.coerce.boolean().default(true),

  PANCAKESWAP_SUBGRAPH_URL: z.string().url().default("https://subgraphs.chainwave-pcs.com/v3/graphql"),
});

type PublicEnv = z.infer<typeof publicSchema>;
type ServerEnv = z.infer<typeof serverSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(`Invalid environment configuration: ${message}`);
    this.name = "EnvError";
  }
}

const isServer = typeof window === "undefined";

function loadPublic(): PublicEnv {
  const result = publicSchema.safeParse(process.env);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

function loadServer(): ServerEnv {
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return result.data;
}

/**
 * Environment variables that are safe to expose to the browser.
 * Available in both client and server code.
 */
export const publicEnv: PublicEnv = loadPublic();

/**
 * Server-only environment variables. Accessing this from client code throws.
 */
let serverEnvCache: ServerEnv | null = null;
export function serverEnv(): ServerEnv {
  if (!isServer) {
    throw new Error("serverEnv() must not be accessed from client code.");
  }
  if (!serverEnvCache) serverEnvCache = loadServer();
  return serverEnvCache;
}
