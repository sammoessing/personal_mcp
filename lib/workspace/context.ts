import { cookies } from "next/headers";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const WORKSPACE_COOKIE = "current_workspace";

export type WorkspaceRole = "owner" | "admin" | "member";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  description: string | null;
  role: WorkspaceRole;
};

/**
 * Every workspace the signed-in user belongs to. Read through the user's own
 * session so row-level security does the filtering — this never sees a
 * workspace they aren't a member of.
 */
export async function listMyWorkspaces(): Promise<Workspace[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, slug, logo_url, description)")
    .eq("user_id", user.id);

  return (data ?? [])
    .map((row) => {
      const ws = row.workspaces as unknown as {
        id: string;
        name: string;
        slug: string;
        logo_url: string | null;
        description: string | null;
      } | null;
      if (!ws) return null;
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        logoUrl: ws.logo_url,
        description: ws.description,
        role: row.role as WorkspaceRole,
      };
    })
    .filter((w): w is Workspace => w !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The workspace the dashboard is currently showing: whichever the cookie names,
 * provided the user is still a member of it, otherwise their first workspace.
 * Membership is re-checked on every call, so a stale or forged cookie can never
 * select a workspace the user doesn't belong to.
 */
export async function getCurrentWorkspace(): Promise<Workspace | null> {
  const workspaces = await listMyWorkspaces();
  if (workspaces.length === 0) return null;

  const cookieStore = await cookies();
  const preferred = cookieStore.get(WORKSPACE_COOKIE)?.value;

  return workspaces.find((w) => w.id === preferred) ?? workspaces[0];
}

/** Throws rather than returning null, for pages that cannot render without one. */
export async function requireCurrentWorkspace(): Promise<Workspace> {
  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    throw new Error("You are not a member of any workspace.");
  }
  return workspace;
}

export function isAdmin(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Server-side membership lookup for code paths that hold a user id directly
 * (the MCP OAuth flow), rather than a browser session.
 */
export async function getMembership(
  userId: string,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data?.role as WorkspaceRole) ?? null;
}
