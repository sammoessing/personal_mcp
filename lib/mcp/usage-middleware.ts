import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { ConnectorProvider } from "@/lib/connectors/registry";

type AnyHandler = (args: unknown) => Promise<unknown>;

/**
 * Wraps an MCP tool handler so every invocation is recorded in tool_calls
 * and appended to the audit hash chain, regardless of which connector (or
 * no connector, for built-in tools) it belongs to. Tracking failures never
 * mask the tool's actual result or error.
 */
export function withUsageTracking<H extends AnyHandler>(
  toolName: string,
  connectorProvider: ConnectorProvider | undefined,
  handler: H
): H {
  return (async (args: unknown) => {
    const startedAt = Date.now();
    let status: "success" | "error" = "success";
    let errorMessage: string | undefined;

    try {
      return await handler(args);
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
          const { data } = await supabase
            .from("connectors")
            .select("id")
            .eq("provider", connectorProvider)
            .maybeSingle();
          connectorId = data?.id ?? null;
        }

        await supabase.from("tool_calls").insert({
          tool_name: toolName,
          connector_id: connectorId,
          status,
          latency_ms: latencyMs,
          error_message: errorMessage,
        });

        await appendAuditEvent("tool_call", {
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
