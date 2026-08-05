import Link from "next/link";
import { Sparkles, Plug, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";
import { eventLabel } from "@/lib/audit/format";
import { getMcpEndpointUrl } from "@/lib/mcp-url";
import { ALL_TOOLS } from "@/lib/mcp/tools";
import { StatCard } from "@/components/dashboard/stat-card";
import { UsagePanel, type DayBar, type UsageRow } from "@/components/dashboard/usage-panel";
import { McpEndpointCard } from "@/components/dashboard/mcp-endpoint-card";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import { listServers } from "@/lib/mcp-client/store";
import { timeAgo, isoMinutesAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Tools that serve a skill to an agent, as opposed to any other kind of call. */
const SKILL_TOOLS = new Set(["get_skill", "list_skills"]);

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Midnight today, in the server's zone — the right edge of the 7-day window. */
function startOfDay(offsetDays = 0): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offsetDays);
  return date;
}

function firstNameFrom(email: string | undefined): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const first = local.split(/[._-]/)[0];
  if (!first) return "there";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export default async function OverviewPage() {
  const ws = await requireCurrentWorkspace();
  const user = await getSessionUser();
  const supabase = await createClient();

  const windowStart = startOfDay(13); // two weeks, to compute a week-on-week delta

  const [
    { count: skillCount },
    { count: mcpExposedSkillCount },
    { data: connectors },
    { data: calls },
    { data: topSkills },
    { data: publishEvents },
    { data: liveTokens },
    { data: auditRows },
    servers,
    endpointUrl,
  ] = await Promise.all([
    supabase.from("skills").select("id", { count: "exact", head: true }).eq("workspace_id", ws.id),
    supabase
      .from("skills")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ws.id)
      .eq("mcp_exposed", true)
      .eq("status", "published"),
    supabase.from("connectors").select("provider, status").eq("workspace_id", ws.id),
    // One pass over the fortnight, aggregated below. Bounded so a busy
    // workspace cannot turn this page into a full table scan.
    supabase
      .from("tool_calls")
      .select("tool_name, connector_id, called_at")
      .eq("workspace_id", ws.id)
      .gte("called_at", windowStart.toISOString())
      .order("called_at", { ascending: false })
      .limit(5000),
    supabase
      .from("skills")
      .select("name, usage_count")
      .eq("workspace_id", ws.id)
      .gt("usage_count", 0)
      .order("usage_count", { ascending: false })
      .limit(3),
    supabase
      .from("audit_log")
      .select("created_at, payload")
      .eq("workspace_id", ws.id)
      .eq("event_type", "skill_status_changed")
      .gte("created_at", windowStart.toISOString())
      .limit(500),
    supabase
      .from("mcp_oauth_tokens")
      .select("client_id, last_used_at")
      .eq("workspace_id", ws.id)
      .eq("revoked", false)
      .gte("last_used_at", windowStart.toISOString()),
    supabase
      .from("audit_log")
      .select("seq, event_type, payload, created_at")
      .eq("workspace_id", ws.id)
      .order("seq", { ascending: false })
      .limit(4),
    listServers(ws.id),
    getMcpEndpointUrl(ws.slug),
  ]);

  // --- Aggregate the fortnight of calls -------------------------------------
  const weekAgo = startOfDay(6).getTime(); // inclusive start of the current 7 days
  const rows = calls ?? [];
  const thisWeek = rows.filter((row) => new Date(row.called_at).getTime() >= weekAgo);
  const priorWeek = rows.filter((row) => new Date(row.called_at).getTime() < weekAgo);

  const skillLoads = (list: typeof rows) => list.filter((row) => SKILL_TOOLS.has(row.tool_name));
  const connectorCalls = (list: typeof rows) => list.filter((row) => row.connector_id !== null);

  /** Counts per day across the current window, oldest first. */
  function daily(list: typeof rows): DayBar[] {
    const buckets = new Map<string, number>();
    for (const row of list) {
      const key = new Date(row.called_at).toDateString();
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return Array.from({ length: 7 }, (_, index) => {
      const day = startOfDay(6 - index);
      return {
        label: DAY_LETTERS[day.getDay()],
        value: buckets.get(day.toDateString()) ?? 0,
      };
    });
  }

  const publishesThisWeek = (publishEvents ?? []).filter(
    (row) =>
      new Date(row.created_at).getTime() >= weekAgo &&
      (row.payload as Record<string, unknown>)?.status === "published"
  ).length;
  const publishesPriorWeek = (publishEvents ?? []).filter(
    (row) =>
      new Date(row.created_at).getTime() < weekAgo &&
      (row.payload as Record<string, unknown>)?.status === "published"
  ).length;

  // Most-used connections, by how many calls each connector backed.
  const usesByConnector = new Map<string, number>();
  for (const row of connectorCalls(thisWeek)) {
    const key = row.connector_id as string;
    usesByConnector.set(key, (usesByConnector.get(key) ?? 0) + 1);
  }
  const { data: usedConnectors } =
    usesByConnector.size > 0
      ? await supabase
          .from("connectors")
          .select("id, display_name, provider")
          .in("id", [...usesByConnector.keys()])
      : { data: [] };

  const connectionRows: UsageRow[] = (usedConnectors ?? [])
    .map((row) => ({
      name: row.display_name ?? row.provider,
      uses: usesByConnector.get(row.id) ?? 0,
    }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 3);

  const skillRows: UsageRow[] = (topSkills ?? []).map((row) => ({
    name: row.name,
    uses: row.usage_count ?? 0,
  }));

  // --- Headline numbers -----------------------------------------------------
  const connectedConnectors = (connectors ?? []).filter((row) => row.status === "connected").length;
  const erroredConnectors = (connectors ?? []).filter((row) => row.status === "error").length;
  const connectionsTotal = connectedConnectors + servers.length;

  const builtInTools = 1 + ALL_TOOLS.filter((tool) => !tool.connector).length; // +1 for ping
  const connectorTools = ALL_TOOLS.filter((tool) => tool.connector).length;

  const sessionsThisWeek = new Set(
    (liveTokens ?? [])
      .filter((row) => row.last_used_at && new Date(row.last_used_at).getTime() >= weekAgo)
      .map((row) => row.client_id)
  );
  const connectedNow = new Set(
    (liveTokens ?? [])
      .filter((row) => row.last_used_at && row.last_used_at >= isoMinutesAgo(15))
      .map((row) => row.client_id)
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {firstNameFrom(user?.email)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ws.name} · {ws.slug}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Agent sessions"
          value={<span className="text-success">{sessionsThisWeek.size}</span>}
          subtitle={`this week · ${connectedNow.size} connected now`}
        />
        <StatCard
          label="MCP tools"
          value={builtInTools + connectorTools}
          subtitle={`${builtInTools} built-in · ${connectorTools} from connectors`}
        />
        <StatCard
          label="Connections"
          value={
            <span className={erroredConnectors > 0 ? "text-warning" : undefined}>
              {connectionsTotal}
            </span>
          }
          subtitle={
            erroredConnectors > 0
              ? `${erroredConnectors} need attention`
              : `${servers.length} MCP · ${connectedConnectors} connectors`
          }
        />
        <StatCard
          label="Skills"
          value={mcpExposedSkillCount ?? 0}
          subtitle={`${skillCount ?? 0} total · ${mcpExposedSkillCount ?? 0} MCP-exposed`}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UsagePanel
          icon={<Sparkles className="size-4" />}
          title="Skills usage"
          primary={{
            label: "Skill loads",
            value: skillLoads(thisWeek).length,
            delta: skillLoads(thisWeek).length - skillLoads(priorWeek).length,
          }}
          secondary={{
            label: "Publishes",
            value: publishesThisWeek,
            delta: publishesThisWeek - publishesPriorWeek,
          }}
          bars={daily(skillLoads(thisWeek))}
          listTitle="Most used skills"
          rows={skillRows}
          emptyText="No skill has been loaded by an agent yet."
        />

        <UsagePanel
          icon={<Plug className="size-4" />}
          title="Connections usage"
          primary={{
            label: "Tool calls",
            value: thisWeek.length,
            delta: thisWeek.length - priorWeek.length,
          }}
          secondary={{
            label: "Connections used",
            value: usesByConnector.size,
            delta:
              usesByConnector.size -
              new Set(connectorCalls(priorWeek).map((row) => row.connector_id)).size,
          }}
          bars={daily(thisWeek)}
          listTitle="Most used connections"
          rows={connectionRows}
          emptyText="No connector has been called yet."
        />
      </div>

      <Card className="mb-6 p-0">
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
                <span className="shrink-0 text-xs text-muted-foreground">
                  {timeAgo(row.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="text-sm font-medium">MCP endpoint</span>
          <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">
            <StatusDot status="success" />
            Serving
          </span>
          <div className="min-w-0 flex-1">
            <McpEndpointCard url={endpointUrl} />
          </div>
          <Link
            href="/mcp-gateway"
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            How to connect Claude, Codex, and more
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </Card>
    </>
  );
}
