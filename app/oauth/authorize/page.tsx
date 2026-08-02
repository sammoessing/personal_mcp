import { cookies } from "next/headers";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import {
  approveAuthorizationAction,
  denyAuthorizationAction,
} from "@/lib/actions/oauth";
import {
  PENDING_AUTH_COOKIE,
  type PendingAuthRequest,
} from "@/app/api/oauth/authorize/route";

export const dynamic = "force-dynamic";

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-lg font-semibold">Authorization failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export default async function AuthorizePage() {
  // Parameters were captured by /api/oauth/authorize and parked in a cookie, so
  // they survive the sign-in round trip that this page may have triggered.
  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_AUTH_COOKIE)?.value;

  if (!raw) {
    return (
      <ErrorScreen message="No authorization request in progress, or it expired. Start the connection again from your MCP client." />
    );
  }

  let pending: PendingAuthRequest;
  try {
    pending = JSON.parse(raw) as PendingAuthRequest;
  } catch {
    return <ErrorScreen message="The authorization request was malformed. Try connecting again." />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <ErrorScreen message="You must be signed in to authorize a client." />;

  if (!pending.clientId || !pending.redirectUri) {
    return <ErrorScreen message="The client did not supply a client_id and redirect_uri." />;
  }
  if (pending.responseType !== "code") {
    return (
      <ErrorScreen
        message={`Unsupported response_type "${pending.responseType}" — only the authorization code flow is supported.`}
      />
    );
  }
  if (!pending.codeChallenge || pending.codeChallengeMethod !== "S256") {
    return <ErrorScreen message="This server requires PKCE with code_challenge_method=S256." />;
  }

  const service = createServiceRoleClient();
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", pending.clientId)
    .maybeSingle();

  if (!client) return <ErrorScreen message="Unknown client. Try connecting again." />;

  // A mismatched redirect_uri is never bounced back to — that would turn this
  // endpoint into an open redirector.
  if (!client.redirect_uris.includes(pending.redirectUri)) {
    return (
      <ErrorScreen message="redirect_uri does not match a registered value for this client." />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border p-6">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-4" />
          </div>
          <h1 className="text-lg font-semibold">Authorize {client.client_name}</h1>
          <p className="text-sm text-muted-foreground">
            This will let it call your Manifest MCP server as{" "}
            <span className="font-medium text-foreground">{user.email}</span>.
          </p>
        </div>

        <div className="mb-5 rounded-md border bg-secondary/40 p-3 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">It will be able to:</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>Read your approved Brain docs and published Skills</li>
            <li>Call tools for every connector you&apos;ve connected</li>
          </ul>
          <p className="mt-2">
            Every call is recorded in your audit trail. You can revoke access any time from the
            MCP Gateway page.
          </p>
        </div>

        <div className="flex gap-2">
          <form action={denyAuthorizationAction} className="flex-1">
            <Button type="submit" variant="outline" className="w-full">
              Cancel
            </Button>
          </form>
          <form action={approveAuthorizationAction} className="flex-1">
            <Button type="submit" className="w-full">
              Authorize
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
