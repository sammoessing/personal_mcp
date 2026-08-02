import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import {
  approveAuthorizationAction,
  denyAuthorizationAction,
} from "@/lib/actions/oauth";

export const dynamic = "force-dynamic";

/**
 * Shows the parameters actually received alongside the failure. These are all
 * non-secret by design (client_id, redirect_uri, state, and the PKCE
 * code_challenge are public values), and without them a failure here is very
 * hard to diagnose from the client side.
 */
function ErrorScreen({
  message,
  received,
}: {
  message: string;
  received?: Record<string, string | undefined>;
}) {
  const entries = Object.entries(received ?? {});

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg text-center">
        <h1 className="text-lg font-semibold">Authorization failed</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>

        <div className="mt-6 rounded-md border bg-secondary/40 p-3 text-left">
          <p className="mb-2 text-xs font-medium">Parameters received</p>
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None — the request arrived with an empty query string.
            </p>
          ) : (
            <dl className="space-y-1">
              {entries.map(([key, value]) => (
                <div key={key} className="flex gap-2 text-xs">
                  <dt className="shrink-0 font-mono text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 flex-1 truncate font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const {
    response_type: responseType,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state,
    scope,
  } = params;

  // The proxy guarantees a signed-in, allow-listed user before this renders.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <ErrorScreen message="You must be signed in to authorize a client." received={params} />;

  // Check for the core params first: if the query string arrived empty, saying
  // so is far more useful than complaining about the response type.
  if (!clientId || !redirectUri) {
    return <ErrorScreen message="Missing client_id or redirect_uri." received={params} />;
  }
  // Absent response_type is tolerated — the code flow is the only one this
  // server implements, so there is nothing else it could have meant. An
  // explicit non-"code" value (e.g. the legacy implicit flow) is still refused.
  if (responseType !== undefined && responseType !== "code") {
    return (
      <ErrorScreen
        message={`Unsupported response_type "${responseType}" — only the authorization code flow is supported.`}
        received={params}
      />
    );
  }
  if (!codeChallenge || (codeChallengeMethod ?? "S256") !== "S256") {
    return <ErrorScreen message="This server requires PKCE with code_challenge_method=S256." received={params} />;
  }

  const service = createServiceRoleClient();
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!client) return <ErrorScreen message="Unknown client. Try connecting again." received={params} />;

  // A mismatched redirect_uri is never bounced back to — that would turn this
  // endpoint into an open redirector.
  if (!client.redirect_uris.includes(redirectUri)) {
    return <ErrorScreen message="redirect_uri does not match a registered value for this client." received={params} />;
  }

  const requestedScope = scope || "mcp";

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
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="state" value={state ?? ""} />
            <Button type="submit" variant="outline" className="w-full">
              Cancel
            </Button>
          </form>
          <form action={approveAuthorizationAction} className="flex-1">
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            <input type="hidden" name="state" value={state ?? ""} />
            <input type="hidden" name="scope" value={requestedScope} />
            <Button type="submit" className="w-full">
              Authorize
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
