import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace, isAdmin } from "@/lib/workspace/context";
import { PageHeader } from "@/components/dashboard/page-header";
import { InviteForm } from "@/components/dashboard/invite-form";
import { BrandingForm } from "@/components/dashboard/branding-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const ws = await requireCurrentWorkspace();
  const admin = isAdmin(ws.role);
  const service = createServiceRoleClient();

  const [{ data: members }, { data: invites }] = await Promise.all([
    service
      .from("workspace_members")
      .select("id, user_id, role, created_at")
      .eq("workspace_id", ws.id)
      .order("created_at"),
    admin
      ? service
          .from("workspace_invites")
          .select("id, email, role, expires_at, accepted_at")
          .eq("workspace_id", ws.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  // Emails live in auth.users, which isn't exposed through PostgREST.
  const { data: authUsers } = await service.auth.admin.listUsers();
  const emailById = new Map((authUsers?.users ?? []).map((u) => [u.id, u.email ?? "unknown"]));

  return (
    <>
      <PageHeader
        title="Members"
        description={`Who can access ${ws.name} and its connectors, skills, and knowledge.`}
      />

      {admin && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Workspace branding</CardTitle>
          </CardHeader>
          <CardContent>
            <BrandingForm
              name={ws.name}
              logoUrl={ws.logoUrl}
              description={ws.description}
            />
          </CardContent>
        </Card>
      )}

      {admin && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteForm workspaceName={ws.name} />
          </CardContent>
        </Card>
      )}

      <Card className="mb-6 p-0">
        <div className="border-b px-5 py-3">
          <span className="text-sm font-medium">Members</span>
        </div>
        <div className="divide-y">
          {(members ?? []).map((member) => (
            <div key={member.id} className="flex items-center justify-between px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {emailById.get(member.user_id) ?? member.user_id}
                </p>
                <p className="text-xs text-muted-foreground">
                  joined {timeAgo(member.created_at)} ago
                </p>
              </div>
              <Badge
                variant={member.role === "owner" ? "default" : member.role === "admin" ? "secondary" : "outline"}
                className="capitalize"
              >
                {member.role}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {admin && (invites ?? []).length > 0 && (
        <Card className="p-0">
          <div className="border-b px-5 py-3">
            <span className="text-sm font-medium">Pending invites</span>
          </div>
          <div className="divide-y">
            {(invites ?? []).map((invite) => (
              <div key={invite.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">
                    expires in {timeAgo(invite.expires_at)}
                  </p>
                </div>
                <Badge variant="outline" className="capitalize">
                  {invite.role}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
