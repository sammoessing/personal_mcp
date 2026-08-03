import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

export const skillTools: ToolDefinition[] = [
  {
    name: "list_skills",
    title: "List skills",
    description: "List published, MCP-exposed Claude Skills from this Manifest library.",
    inputSchema: {},
    handler: async (_args: unknown, ctx: ToolContext) => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("skills")
        .select("name, slug, description, version")
        .eq("workspace_id", ctx.workspaceId)
        .eq("status", "published")
        .eq("mcp_exposed", true)
        .order("name");
      if (error) return errorResult(error.message);
      if (!data || data.length === 0) return textResult("No published skills yet.");
      return textResult(
        data.map((s) => `${s.name} (${s.slug}) v${s.version} — ${s.description}`).join("\n")
      );
    },
  },
  {
    name: "get_skill",
    title: "Get skill",
    description: "Fetch a published, MCP-exposed skill's full content by slug.",
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
        .eq("status", "published")
        .eq("mcp_exposed", true)
        .maybeSingle();
      if (error) return errorResult(error.message);
      if (!data) return errorResult(`No published skill found for slug "${slug}".`);

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
