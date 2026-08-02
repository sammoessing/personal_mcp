import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { hashSecret, randomToken, AUTH_CODE_TTL_SECONDS } from "@/lib/oauth/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { PENDING_AUTH_COOKIE, type PendingAuthRequest } from "../route";

/**
 * Completes the authorization step.
 *
 * This is a route handler rather than a Server Action deliberately: the final
 * hop sends the user to the client's own origin (e.g. claude.ai), and a plain
 * 303 from a route handler is a real HTTP redirect the browser follows.
 * Server Action redirects are routed through the App Router client instead,
 * which does not handle the cross-origin case reliably, and any failure there
 * surfaces as an unhelpful generic error page.
 */
function errorRedirect(origin: string, message: string) {
  const url = new URL("/oauth/error", origin);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const cookieStore = await cookies();

  const raw = cookieStore.get(PENDING_AUTH_COOKIE)?.value;
  if (!raw) {
    return errorRedirect(origin, "No authorization request in progress, or it expired.");
  }

  let pending: PendingAuthRequest;
  try {
    pending = JSON.parse(raw) as PendingAuthRequest;
  } catch {
    return errorRedirect(origin, "The authorization request was malformed.");
  }

  const form = await request.formData();
  const approved = String(form.get("decision") ?? "") === "approve";

  // Only the signed-in, allow-listed user can grant access.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (!user || (allowedEmail && user.email !== allowedEmail)) {
    return errorRedirect(origin, "You are not signed in as the authorized user.");
  }

  const service = createServiceRoleClient();
  const { data: client, error: clientError } = await service
    .from("mcp_oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", pending.clientId)
    .maybeSingle();

  if (clientError) {
    return errorRedirect(origin, `Could not load the client: ${clientError.message}`);
  }
  if (!client) return errorRedirect(origin, "Unknown client. Try connecting again.");

  // Never redirect to an unregistered URI — that would make this an open redirector.
  if (!client.redirect_uris.includes(pending.redirectUri)) {
    return errorRedirect(origin, "redirect_uri does not match a registered value.");
  }

  const destination = new URL(pending.redirectUri);

  if (!approved) {
    destination.searchParams.set("error", "access_denied");
    if (pending.state) destination.searchParams.set("state", pending.state);
    const response = NextResponse.redirect(destination, 303);
    response.cookies.delete(PENDING_AUTH_COOKIE);
    return response;
  }

  if (!pending.codeChallenge) {
    return errorRedirect(origin, "The client did not supply a PKCE code_challenge.");
  }

  const code = randomToken();
  const { error: insertError } = await service.from("mcp_oauth_codes").insert({
    code_hash: hashSecret(code),
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
    code_challenge: pending.codeChallenge,
    code_challenge_method: "S256",
    scope: pending.scope,
    user_email: user.email!,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (insertError) {
    return errorRedirect(origin, `Could not issue an authorization code: ${insertError.message}`);
  }

  // Audit logging must never block the grant that already succeeded.
  try {
    await appendAuditEvent("mcp_client_authorized", {
      client_id: pending.clientId,
      scope: pending.scope,
    });
  } catch {
    // Recorded on a best-effort basis; the authorization itself stands.
  }

  destination.searchParams.set("code", code);
  if (pending.state) destination.searchParams.set("state", pending.state);

  const response = NextResponse.redirect(destination, 303);
  response.cookies.delete(PENDING_AUTH_COOKIE);
  return response;
}
