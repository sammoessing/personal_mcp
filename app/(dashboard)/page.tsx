import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { verifyAuditChain } from "@/lib/audit/hash-chain";
import { eventLabel } from "@/lib/audit/format";
import { getMcpEndpointUrl } from "@/lib/mcp-url";
import { ALL_TOOLS } from "@/lib/mcp/tools";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { McpEndpointCard } from "@/components/dashboard/mcp-endpoint-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { timeAgo, isoMinutesAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const supabase = await createClient();

  const [
    { count: skillCount },
    { count: mcpExposedSkillCount },
    { data: connectors },
    { data: liveSessions },
    { data: auditRows },
    verifyResult,
    endpointUrl,
  ] = await Promise.all([
    supabase.from("skills").select("id", { count: "exact", head: true }),
    supabase
      .from("skills")
      .select("id", { count: "exact", head: true })
      .eq("mcp_exposed", true)
      .eq("status", "published"),
    supabase.from("connectors").select("provider, status"),
    supabase
      .from("sessions")
      .select("client_name")
      .eq("status", "live")
      .gte("last_seen_at", isoMinutesAgo(15)),
    supabase
      .from("audit_log")
      .select("seq, event_type, payload, created_at")
      .order("seq", { ascending: false })
      .limit(4),
    verifyAuditChain(),
    getMcpEndpointUrl(),
  ]);

  const connectedServers = (connectors ?? []).filter((c) => c.status === "connected").length;
  const totalTools = 1 + ALL_TOOLS.length; // +1 for the built-in ping tool
  const liveClients = new Set((liveSessions ?? []).map((s) => s.client_name));

  return (
    <>
      <PageHeader title="Overview" description="Workspace activity and posture at a glance." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>MCP endpoint</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <McpEndpointCard url={endpointUrl} />
          <p className="text-xs text-muted-foreground">
            Point Claude Desktop, Claude Code, or any MCP client at this URL with an{" "}
            <code>Authorization: Bearer</code> header. See{" "}
            <Link href="/mcp-gateway" className="underline underline-offset-4">
              MCP Gateway
            </Link>{" "}
            for the full tool catalog.
          </p>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Skills"
          value={skillCount ?? 0}
          subtitle={`${mcpExposedSkillCount ?? 0} MCP-exposed`}
        />
        <StatCard
          label="Tools exposed"
          value={totalTools}
          subtitle={`${connectedServers} servers`}
        />
        <StatCard
          label="Live sessions"
          value={liveSessions?.length ?? 0}
          subtitle={`${liveClients.size} clients`}
        />
        <StatCard
          label="Audit trail"
          value={verifyResult.verified ? "Verified" : "Broken"}
          subtitle="hash-chained"
        />
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <span className="text-sm font-medium">Recent activity</span>
          <Link href="/audit" className="text-xs text-muted-foreground underline underline-offset-4">
            View all
          </Link>
        </div>
        {!auditRows || auditRows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing has happened yet.</p>
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
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(row.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
