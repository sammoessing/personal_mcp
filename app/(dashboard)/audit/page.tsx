import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { verifyAuditChain } from "@/lib/audit/hash-chain";
import { eventLabel } from "@/lib/audit/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { VerifyChainButton } from "@/components/dashboard/verify-chain-button";
import { StatusDot } from "@/components/ui/status-dot";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

type ToolCallRow = {
  tool_name: string;
  status: "success" | "error";
  latency_ms: number | null;
  called_at: string;
};

export default async function AuditPage() {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: auditRows }, { data: toolCalls }, verifyResult] = await Promise.all([
    supabase
      .from("audit_log")
      .select("seq, event_type, payload, created_at")
      .eq("workspace_id", ws.id)
      .order("seq", { ascending: false })
      .limit(50),
    supabase
      .from("tool_calls")
      .select("tool_name, status, latency_ms, called_at")
      .eq("workspace_id", ws.id)
      .order("called_at", { ascending: false })
      .limit(2000),
    verifyAuditChain(ws.id),
  ]);

  const usageByTool = new Map<
    string,
    { count: number; errors: number; totalLatency: number; lastUsed: string }
  >();
  for (const call of (toolCalls ?? []) as ToolCallRow[]) {
    const entry = usageByTool.get(call.tool_name) ?? {
      count: 0,
      errors: 0,
      totalLatency: 0,
      lastUsed: call.called_at,
    };
    entry.count += 1;
    if (call.status === "error") entry.errors += 1;
    entry.totalLatency += call.latency_ms ?? 0;
    if (call.called_at > entry.lastUsed) entry.lastUsed = call.called_at;
    usageByTool.set(call.tool_name, entry);
  }
  const usageRows = [...usageByTool.entries()].sort((a, b) => b[1].count - a[1].count);

  return (
    <>
      <PageHeader
        title="Audit"
        description="Every tool call and workflow event, hash-chained end to end."
        action={<VerifyChainButton initial={verifyResult} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tool usage</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {usageRows.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted-foreground">
                No tool calls recorded yet.
              </p>
            ) : (
              <div className="divide-y">
                {usageRows.map(([toolName, stats]) => (
                  <div key={toolName} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{toolName}</p>
                      <p className="text-xs text-muted-foreground">
                        last used {timeAgo(stats.lastUsed)} ago · avg{" "}
                        {Math.round(stats.totalLatency / stats.count)}ms
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {stats.errors > 0 && (
                        <Badge variant="destructive">{stats.errors} errors</Badge>
                      )}
                      <Badge variant="secondary">{stats.count} calls</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chain feed</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!auditRows || auditRows.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-muted-foreground">No audit events yet.</p>
            ) : (
              <div className="divide-y">
                {auditRows.map((row) => (
                  <div key={row.seq} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <StatusDot
                      status={
                        row.event_type === "tool_call" &&
                        (row.payload as Record<string, unknown>).status === "error"
                          ? "destructive"
                          : "success"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {eventLabel(row.event_type, row.payload as Record<string, unknown>)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(row.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
