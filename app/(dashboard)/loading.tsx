/**
 * Every dashboard page is per-user and rendered on demand, so a navigation
 * blocks on the server round trip. This skeleton renders instantly inside the
 * existing shell, so clicking a nav item responds immediately instead of
 * appearing to hang until the data arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-6">
        <div className="h-6 w-40 rounded-md bg-secondary" />
        <div className="mt-2 h-4 w-72 rounded-md bg-secondary/60" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg border bg-card" />
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-5 py-4 last:border-b-0">
            <div className="h-4 flex-1 rounded bg-secondary/70" />
            <div className="h-4 w-20 rounded bg-secondary/50" />
            <div className="h-4 w-10 rounded bg-secondary/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
