import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import type { ToolContext } from "./types";

type AnyHandler = (args: never, ctx: ToolContext) => Promise<unknown>;

/**
 * Wraps an MCP tool handler so every invocation is recorded in tool_calls and
 * appended to that workspace's audit hash chain. Tracking failures never mask
 * the tool's actual result or error.
 */
export function withUsageTracking<H extends AnyHandler>(
  toolName: string,
  connectorProvider: ConnectorProvider | undefined,
  handler: H
): H {
  return (async (args: never, ctx: ToolContext) => {
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    let errorMessage: string | undefined;

    try {
      return await handler(args, ctx);
    } catch (err) {
      status = "error";
      errorMessage = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      try {
        const latencyMs = Date.now() - startedAt;
        const supabase = createServiceRoleClient();

        let connectorId: string | null = null;
        if (connectorProvider) {
          // A per-member provider has one row per person, so (workspace, provider)
          // alone matches several — narrow to the caller's own row, or the
          // shared row for workspace-scoped providers.
          let query = supabase
            .from("connectors")
            .select("id")
            .eq("workspace_id", ctx.workspaceId)
            .eq("provider", connectorProvider);
          query =
            CONNECTOR_REGISTRY[connectorProvider].scope === "member"
              ? query.eq("user_id", ctx.userId ?? "")
              : query.is("user_id", null);
          const { data } = await query.maybeSingle();
          connectorId = data?.id ?? null;
        }

        await supabase.from("tool_calls").insert({
          workspace_id: ctx.workspaceId,
          tool_name: toolName,
          connector_id: connectorId,
          status,
          latency_ms: latencyMs,
          error_message: errorMessage,
        });

        await appendAuditEvent(ctx.workspaceId, "tool_call", {
          tool: toolName,
          connector: connectorProvider ?? null,
          status,
          latency_ms: latencyMs,
        });
      } catch {
        // Usage tracking is best-effort and must never mask the tool's
        // actual result or error.
      }
    }
  }) as H;
}
