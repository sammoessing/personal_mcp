"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { slugify } from "@/lib/slug";
import { requireCurrentWorkspace } from "@/lib/workspace/context";

export type SkillStatus = "draft" | "review" | "approved" | "published";

export async function createSkillAction(formData: FormData) {
  const ws = await requireCurrentWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!name) throw new Error("Name is required.");

  const supabase = await createClient();
  const slug = slugify(name);
  const { data, error } = await supabase
    .from("skills")
    .insert({ workspace_id: ws.id, name, slug, description, content })
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
  if (!name) throw new Error("Name is required.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("skills")
    .update({ name, description, version, content, updated_at: new Date().toISOString() })
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
