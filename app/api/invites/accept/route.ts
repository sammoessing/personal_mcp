import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";

/**
 * Redeems an invite for the currently signed-in user.
 *
 * The membership that gets created is defined entirely by the invite row —
 * workspace and role both come from the database, never from the request — so
 * holding a link cannot grant more than it was issued for.
 */
export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (!token) {
    return NextResponse.json({ error: "Missing invite token." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const service = createServiceRoleClient();
  const { data: invite } = await service
    .from("workspace_invites")
    .select("id, workspace_id, email, role, expires_at, accepted_at")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .maybeSingle();

  if (!invite) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }
  if (invite.accepted_at) {
    return NextResponse.json({ error: "This invite has already been used." }, { status: 409 });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "This invite has expired." }, { status: 410 });
  }
  // The signed-in account must be the one the invite was addressed to,
  // otherwise a leaked link would let anyone join.
  if ((user.email ?? "").toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: "This invite was issued to a different email address." },
      { status: 403 }
    );
  }

  const { error } = await service.from("workspace_members").upsert(
    { workspace_id: invite.workspace_id, user_id: user.id, role: invite.role },
    { onConflict: "workspace_id,user_id" }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await service
    .from("workspace_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  try {
    await appendAuditEvent(invite.workspace_id, "member_joined", {
      email: invite.email,
      role: invite.role,
    });
  } catch {
    // Best-effort: the membership itself already succeeded.
  }

  return NextResponse.json({ ok: true });
}
