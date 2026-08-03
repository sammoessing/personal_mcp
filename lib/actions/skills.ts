"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { slugify } from "@/lib/slug";
import { requireCurrentWorkspace } from "@/lib/workspace/context";

export type SkillStatus = "draft" | "review" | "approved" | "published";
export type SkillVisibility = "private" | "team" | "company" | "marketplace";

const VISIBILITIES: SkillVisibility[] = ["private", "team", "company", "marketplace"];

/** "support, policy" -> ["support", "policy"], de-duplicated and trimmed. */
function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

function parseVisibility(raw: string): SkillVisibility {
  return VISIBILITIES.includes(raw as SkillVisibility)
    ? (raw as SkillVisibility)
    : "private";
}

export async function createSkillAction(formData: FormData) {
  const ws = await requireCurrentWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  const visibility = parseVisibility(String(formData.get("visibility") ?? "private"));
  const tags = parseTags(String(formData.get("tags") ?? ""));
  if (!name) throw new Error("A title is required.");

  const supabase = await createClient();
  const slug = slugify(name);
  const { data, error } = await supabase
    .from("skills")
    .insert({ workspace_id: ws.id, name, slug, description, content, visibility, tags })
    .select("slug, name")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "skill_created", { name: data.name, slug: data.slug });
  revalidatePath("/skills");
  redirect(`/skills/${data.slug}`);
}

export async function updateSkillAction(slug: string, formData: FormData) {
  const ws = await requireCurrentWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const version = String(formData.get("version") ?? "0.1.0").trim();
  const content = String(formData.get("content") ?? "");
  const visibility = parseVisibility(String(formData.get("visibility") ?? "private"));
  const tags = parseTags(String(formData.get("tags") ?? ""));
  if (!name) throw new Error("A title is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("skills")
    .update({ name, description, version, content, visibility, tags, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug);
  if (error) throw new Error(error.message);

  revalidatePath(`/skills/${slug}`);
  revalidatePath("/skills");
}

export async function setSkillStatusAction(slug: string, status: SkillStatus) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("skills")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .select("name")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "skill_status_changed", { name: data.name, slug, status });
  revalidatePath(`/skills/${slug}`);
  revalidatePath("/skills");
}

export async function setSkillMcpExposedAction(slug: string, exposed: boolean) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("skills")
    .update({ mcp_exposed: exposed, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .select("name")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "skill_mcp_exposure_changed", { name: data.name, slug, exposed });
  revalidatePath(`/skills/${slug}`);
  revalidatePath("/skills");
}

export async function deleteSkillAction(slug: string) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { error } = await supabase.from("skills").delete().eq("workspace_id", ws.id)
    .eq("slug", slug);
  if (error) throw new Error(error.message);

  revalidatePath("/skills");
  redirect("/skills");
}
