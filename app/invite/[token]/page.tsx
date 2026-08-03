import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isoMinutesAgo } from "@/lib/format";
import { AcceptInviteForm } from "./accept-form";

export const dynamic = "force-dynamic";

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const service = createServiceRoleClient();

  // The link carries the raw token; only its hash was ever stored.
  const { data: invite } = await service
    .from("workspace_invites")
    .select("id, email, role, expires_at, accepted_at, workspaces(name)")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    // Expiry is filtered in the query rather than compared in the component
    // body, which must stay free of impure calls like Date.now().
    .gt("expires_at", isoMinutesAgo(0))
    .maybeSingle();

  if (!invite) {
    return (
      <Message
        title="Invite not valid"
        body="This link is invalid or has expired. Ask for a new one."
      />
    );
  }
  if (invite.accepted_at) {
    return (
      <Message title="Already accepted" body="This invite has been used. Sign in instead." />
    );
  }
  const workspace = invite.workspaces as unknown as { name: string } | null;

  return (
    <AcceptInviteForm
      token={token}
      email={invite.email}
      workspaceName={workspace?.name ?? "the workspace"}
    />
  );
}
