"use server";

import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { sendInviteEmail } from "@/lib/email/send";
import {
  WORKSPACE_COOKIE,
  listMyWorkspaces,
  requireCurrentWorkspace,
  getSessionUser,
  isAdmin,
  type WorkspaceRole,
} from "@/lib/workspace/context";
import { CONNECTOR_LIST } from "@/lib/connectors/registry";
import { slugify } from "@/lib/slug";

/** Switching only succeeds for a workspace the user is actually a member of. */
/**
 * Creates a workspace and makes the caller its owner.
 *
 * Only the workspace-scoped connectors get placeholder rows. Gmail, Calendar
 * and Discord are per-member, and a shared placeholder for those could never
 * be claimed under the partial unique indexes from 0008 — their rows are
 * created when a specific person connects one.
 */
export async function createWorkspaceAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  if (!name) throw new Error("Give the workspace a name.");

  const user = await getSessionUser();
  if (!user) throw new Error("You must be signed in.");

  const service = createServiceRoleClient();
  const baseSlug = slugify(name) || "workspace";

  // Slugs appear in the MCP endpoint URL, so a collision has to be resolved
  // rather than rejected — the person naming it should not have to guess what
  // another tenant already took.
  let slug = baseSlug;
  for (let attempt = 2; attempt <= 50; attempt++) {
    const { data: taken } = await service
      .from("workspaces")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!taken) break;
    slug = `${baseSlug}-${attempt}`;
  }

  const { data: workspace, error } = await service
    .from("workspaces")
    .insert({ name, slug, description })
    .select("id, slug")
    .single();
  if (error) throw new Error(error.message);

  const { error: memberError } = await service
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  if (memberError) throw new Error(memberError.message);

  const shared = CONNECTOR_LIST.filter((def) => def.scope === "workspace");
  if (shared.length > 0) {
    await service.from("connectors").insert(
      shared.map((def) => ({
        workspace_id: workspace.id,
        provider: def.provider,
        display_name: def.displayName,
        scopes: def.scopes,
      }))
    );
  }

  await appendAuditEvent(workspace.id, "workspace_created", { name, slug });

  // Land in the new workspace rather than leaving the person to switch.
  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  return { id: workspace.id, slug: workspace.slug };
}

export async function switchWorkspaceAction(workspaceId: string) {
  const workspaces = await listMyWorkspaces();
  if (!workspaces.some((w) => w.id === workspaceId)) {
    throw new Error("You are not a member of that workspace.");
  }

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}

export type InviteResult = {
  token: string;
  inviteUrl: string;
  emailed: boolean;
  /** Why the email didn't go out, when it didn't. */
  emailError?: string;
};

export async function inviteMemberAction(formData: FormData): Promise<InviteResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member") as WorkspaceRole;
  if (!email) throw new Error("Email is required.");

  const ws = await requireCurrentWorkspace();
  if (!isAdmin(ws.role)) throw new Error("Only admins can invite members.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The raw token only ever exists in the invite link; the row stores its hash.
  const token = randomBytes(24).toString("base64url");
  const service = createServiceRoleClient();
  const { error } = await service.from("workspace_invites").insert({
    workspace_id: ws.id,
    email,
    role,
    token_hash: createHash("sha256").update(token).digest("hex"),
    invited_by: user?.id ?? null,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "member_invited", { email, role });

  // The origin has to come from the request headers: this runs on the server,
  // where there is no window.location to build the link from.
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const inviteUrl = `${proto}://${host}/invite/${token}`;

  // Sending is attempted after the invite exists, so a mail failure costs you
  // the email, not the invitation — the link still works.
  const result = await sendInviteEmail({
    to: email,
    inviteUrl,
    workspaceName: ws.name,
    workspaceLogoUrl: ws.logoUrl,
    invitedByEmail: user?.email ?? null,
  });

  revalidatePath("/members");

  return {
    token,
    inviteUrl,
    emailed: result.sent,
    ...(result.sent ? {} : { emailError: result.reason }),
  };
}

export async function revokeInviteAction(inviteId: string) {
  const ws = await requireCurrentWorkspace();
  if (!isAdmin(ws.role)) throw new Error("Only admins can revoke invites.");

  const service = createServiceRoleClient();
  await service
    .from("workspace_invites")
    .delete()
    .eq("id", inviteId)
    .eq("workspace_id", ws.id);

  revalidatePath("/members");
}

export async function removeMemberAction(memberId: string) {
  const ws = await requireCurrentWorkspace();
  if (!isAdmin(ws.role)) throw new Error("Only admins can remove members.");

  const service = createServiceRoleClient();
  const { data: member } = await service
    .from("workspace_members")
    .select("user_id, role")
    .eq("id", memberId)
    .eq("workspace_id", ws.id)
    .maybeSingle();
  if (!member) throw new Error("Member not found.");
  if (member.role === "owner") throw new Error("The workspace owner cannot be removed.");

  await service
    .from("workspace_members")
    .delete()
    .eq("id", memberId)
    .eq("workspace_id", ws.id);

  // Any MCP token that member held for this workspace stops working immediately.
  await service
    .from("mcp_oauth_tokens")
    .update({ revoked: true })
    .eq("workspace_id", ws.id)
    .eq("user_email", member.user_id);

  await appendAuditEvent(ws.id, "member_removed", { member_id: memberId });
  revalidatePath("/members");
}

export async function updateWorkspaceBrandingAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const logoUrl = String(formData.get("logo_url") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("Name is required.");

  // Only https images, so a workspace logo can't be used to point clients at
  // arbitrary schemes.
  if (logoUrl && !/^https:\/\//i.test(logoUrl)) {
    throw new Error("Logo URL must start with https://");
  }

  const ws = await requireCurrentWorkspace();
  if (!isAdmin(ws.role)) throw new Error("Only admins can change workspace branding.");

  const service = createServiceRoleClient();
  const { error } = await service
    .from("workspaces")
    .update({
      name,
      logo_url: logoUrl || null,
      description: description || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ws.id);
  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
}
