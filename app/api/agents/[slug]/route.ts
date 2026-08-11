import { getAgentBySlug, recordAgentView } from "@/lib/services/agents";
import { getSessionWallet } from "@/lib/auth/session";
import { handle, ok } from "@/lib/api/response";

/** GET /api/agents/[slug] — full agent profile (capabilities, performance, on-chain identity). */
export const GET = handle(async (_request: Request, ctx: RouteContext<"/api/agents/[slug]">) => {
  const { slug } = await ctx.params;
  const agent = await getAgentBySlug(slug);
  const session = await getSessionWallet();
  // Record a view for trending (anonymous when not signed in).
  await recordAgentView(agent.id, session?.wallet ?? null);
  return ok(agent);
});
