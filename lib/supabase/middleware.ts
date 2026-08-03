import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/auth-code-error",
  // Invited users follow this link before they belong to any workspace.
  "/invite",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  // Access is membership-based: being signed in is necessary but not
  // sufficient. Page-level code re-derives the workspace and its role, and
  // row-level security independently refuses rows from workspaces the user
  // does not belong to.
  const isAuthorized = !!user;

  if (!isAuthorized && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were headed so the OAuth consent flow resumes after
    // sign-in instead of dumping them on the dashboard mid-authorization.
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  if (isAuthorized && path === "/login") {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    // Only same-origin relative paths, so ?next= can't be used as an open redirect.
    url.pathname = next?.startsWith("/") && !next.startsWith("//") ? next.split("?")[0] : "/";
    url.search = next?.includes("?") ? next.slice(next.indexOf("?")) : "";
    return NextResponse.redirect(url);
  }

  return response;
}
