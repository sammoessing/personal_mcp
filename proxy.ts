import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * The MCP endpoint (/api/mcp, plus /api/sse and /api/message from the
     * same [transport] route) authenticates itself via bearer token, not
     * the Supabase cookie session — excluded here so MCP clients never hit
     * the login redirect. Static assets are excluded for the same reason
     * as any Next.js auth proxy guide.
     */
    "/((?!api/(?:mcp|sse|message)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
