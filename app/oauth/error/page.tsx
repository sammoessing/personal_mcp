import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OAuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-lg font-semibold">Authorization failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {message ?? "Something went wrong while authorizing the client."}
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Start the connection again from your MCP client, or{" "}
          <Link href="/mcp-gateway" className="underline underline-offset-4">
            open the MCP Gateway
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
