"use server";

import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import {
  WORKSPACE_COOKIE,
  listMyWorkspaces,
  requireCurrentWorkspace,
  isAdmin,
  type WorkspaceRole,
} from "@/lib/workspace/context";

/** Switching only succeeds for a workspace the user is actually a member of. */
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

export async function inviteMemberAction(formData: FormData) {
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
  revalidatePath("/members");

  // Surfaced in the UI to copy — there is no outbound email configured.
  return token;
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
