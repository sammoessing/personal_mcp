import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { listMyWorkspaces, getCurrentWorkspace } from "@/lib/workspace/context";
import { Topbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [{ data: { user } }, workspaces, current] = await Promise.all([
    supabase.auth.getUser(),
    listMyWorkspaces(),
    getCurrentWorkspace(),
  ]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar workspaces={workspaces} current={current} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={user?.email ?? ""} />
        <main className="flex-1 overflow-y-auto px-8 py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
