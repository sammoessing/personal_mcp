import { NextResponse } from "next/server";

export const PENDING_AUTH_COOKIE = "mcp_oauth_request";

export type PendingAuthRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
  scope: string;
  responseType: string;
};

/**
 * Entry point for the authorization flow.
 *
 * The consent UI needs a signed-in user, so an unauthenticated request has to
 * bounce through /login and back. Carrying the full OAuth query string across
 * that round trip is fragile — it has to survive being packed into a `next`
 * parameter, re-encoded, and replayed. Instead this handler captures the
 * parameters from the raw request URL the moment they arrive, parks them in a
 * short-lived httpOnly cookie, and sends the browser to a bare /oauth/authorize.
 *
 * The consent page then reads the cookie, so nothing depends on query strings
 * surviving redirects.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";

  const pending: PendingAuthRequest = {
    clientId,
    redirectUri,
    codeChallenge: params.get("code_challenge") ?? "",
    codeChallengeMethod: params.get("code_challenge_method") ?? "S256",
    state: params.get("state") ?? "",
    scope: params.get("scope") ?? "mcp",
    responseType: params.get("response_type") ?? "code",
  };

  const destination = new URL("/oauth/authorize", url.origin);
  const response = NextResponse.redirect(destination);

  response.cookies.set(PENDING_AUTH_COOKIE, JSON.stringify(pending), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
