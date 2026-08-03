import { Sidebar } from "@/components/dashboard/sidebar";
import {
  listMyWorkspaces,
  getCurrentWorkspace,
  getSessionUser,
} from "@/lib/workspace/context";
import { Topbar } from "@/components/dashboard/topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // All three are request-cached, and getCurrentWorkspace reuses the same
  // workspace list, so this resolves with one auth check and one query no
  // matter how many of them the page below also asks for.
  const [user, workspaces, current] = await Promise.all([
    getSessionUser(),
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
