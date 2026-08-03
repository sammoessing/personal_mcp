import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

/**
 * Lifecycle states whose skills are served to MCP clients. A skill still has to
 * clear review, but once it has, the mcp_exposed switch is what decides whether
 * clients see it — requiring "published" on top of that meant two separate
 * gates for the same intent, and an approved-and-exposed skill silently didn't
 * appear. This also matches the Brain, which serves docs at "approved".
 */
export const MCP_SERVED_SKILL_STATUSES = ["approved", "published"];

export const skillTools: ToolDefinition[] = [
  {
    name: "list_skills",
    title: "List skills",
    description: "List the Claude Skills this workspace serves: approved or published, and exposed to MCP.",
    inputSchema: {},
    handler: async (_args: unknown, ctx: ToolContext) => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("skills")
        .select("name, slug, description, version")
        .eq("workspace_id", ctx.workspaceId)
        .in("status", MCP_SERVED_SKILL_STATUSES)
        .eq("mcp_exposed", true)
        .order("name");
      if (error) return errorResult(error.message);
      if (!data || data.length === 0)
        return textResult("No skills are being served yet — a skill must be approved and MCP-exposed.");
      return textResult(
        data.map((s) => `${s.name} (${s.slug}) v${s.version} — ${s.description}`).join("\n")
      );
    },
  },
  {
    name: "get_skill",
    title: "Get skill",
    description: "Fetch a served skill's full content by slug.",
    inputSchema: {
      slug: z.string().describe("Skill slug, from list_skills"),
    },
    handler: async ({ slug }: { slug: string }, ctx: ToolContext) => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("skills")
        .select("name, content, version")
        .eq("workspace_id", ctx.workspaceId)
        .eq("slug", slug)
        .in("status", MCP_SERVED_SKILL_STATUSES)
        .eq("mcp_exposed", true)
        .maybeSingle();
      if (error) return errorResult(error.message);
      if (!data)
        return errorResult(
          `No served skill found for slug "${slug}". It may exist but not be approved or MCP-exposed.`
        );

      // Mirrors Manifest's usageCount/lastUsedAt so the Skills page can show
      // which skills actually get picked up by clients.
      await supabase.rpc("increment_skill_usage", {
        p_workspace_id: ctx.workspaceId,
        p_slug: slug,
      });

      return textResult(`# ${data.name} (v${data.version})\n\n${data.content}`);
    },
  },
];
