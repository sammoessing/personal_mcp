import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Excluded from the session gate:
     * - api/mcp|sse|message — the MCP endpoint authenticates with a bearer
     *   token, not the Supabase cookie, so clients must never be bounced to
     *   the login page.
     * - .well-known/* and api/oauth/(metadata|protected-resource|register|token)
     *   — OAuth discovery, client registration, and token exchange are called
     *   by machines with no browser session, and are unauthenticated by
     *   design (see the note in the register route).
     * - api/oauth/authorize — only parks the request parameters in a cookie and
     *   redirects. It must run before sign-in, precisely so the parameters are
     *   captured ahead of any login round trip.
     *
     * - oauth/error — must stay readable even when the failure was "you are
     *   not signed in", otherwise the explanation is replaced by a login
     *   redirect and the user learns nothing.
     *
     * /oauth/authorize (the consent page) is deliberately NOT excluded: it is
     * the one part of the flow that must run as the signed-in user.
     */
    "/((?!api/(?:mcp|sse|message)|api/oauth/(?:metadata|protected-resource|register|token|authorize)|oauth/error|api/invites/accept|\\.well-known|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
