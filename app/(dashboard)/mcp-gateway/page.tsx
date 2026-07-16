import { createClient } from "@/lib/supabase/server";
import { ALL_TOOLS } from "@/lib/mcp/tools";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import { getMcpEndpointUrl } from "@/lib/mcp-url";
import { PageHeader } from "@/components/dashboard/page-header";
import { McpEndpointCard } from "@/components/dashboard/mcp-endpoint-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";

export const dynamic = "force-dynamic";

export default async function McpGatewayPage() {
  const supabase = await createClient();
  const [endpointUrl, { data: connectors }, { count: publishedSkillCount }] = await Promise.all([
    getMcpEndpointUrl(),
    supabase.from("connectors").select("provider, status"),
    supabase
      .from("skills")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("mcp_exposed", true),
  ]);

  const connectedProviders = new Set(
    (connectors ?? []).filter((c) => c.status === "connected").map((c) => c.provider)
  );

  const groups = new Map<string, typeof ALL_TOOLS>();
  groups.set("built-in", [{
    name: "ping",
    title: "Ping",
    description: "Health check — confirms the MCP server is reachable.",
    inputSchema: {},
    handler: async () => ({ content: [] }),
  }, ...ALL_TOOLS.filter((t) => !t.connector)]);
  for (const provider of Object.keys(CONNECTOR_REGISTRY) as ConnectorProvider[]) {
    const tools = ALL_TOOLS.filter((t) => t.connector === provider);
    if (tools.length > 0) groups.set(provider, tools);
  }

  const totalTools = 1 + ALL_TOOLS.length; // +1 for the built-in ping tool

  return (
    <>
      <PageHeader
        title="MCP Gateway"
        description="The single MCP endpoint every client connects to, and every tool it exposes."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <McpEndpointCard url={endpointUrl} />
          <p className="text-xs text-muted-foreground">
            Streamable HTTP transport. Add an <code>Authorization: Bearer &lt;MCP_ACCESS_TOKEN&gt;</code>{" "}
            header in your client config — {totalTools} tools and {publishedSkillCount ?? 0} published
            skills are exposed here.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {[...groups.entries()].map(([key, tools]) => {
          const isBuiltIn = key === "built-in";
          const provider = key as ConnectorProvider;
          const displayName = isBuiltIn ? "Built-in" : CONNECTOR_REGISTRY[provider].displayName;
          const isLive = isBuiltIn || connectedProviders.has(provider);

          return (
            <Card key={key} className="p-0">
              <div className="flex items-center justify-between border-b px-5 py-3">
                <span className="text-sm font-medium">{displayName}</span>
                <Badge variant={isLive ? "success" : "outline"} className="gap-1.5">
                  <StatusDot status={isLive ? "success" : "neutral"} />
                  {isLive ? "Live" : "Connect to activate"}
                </Badge>
              </div>
              <div className="divide-y">
                {tools.map((tool) => (
                  <div key={tool.name} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium">{tool.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{tool.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
