"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  hashSecret,
  randomToken,
  AUTH_CODE_TTL_SECONDS,
} from "@/lib/oauth/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import {
  PENDING_AUTH_COOKIE,
  type PendingAuthRequest,
} from "@/app/api/oauth/authorize/route";

/**
 * Reads the in-progress authorization request from its httpOnly cookie. Taking
 * the parameters from here rather than hidden form fields means a forged POST
 * to this action can't substitute its own client_id or redirect_uri.
 */
async function readPendingRequest(): Promise<PendingAuthRequest | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_AUTH_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuthRequest;
  } catch {
    return null;
  }
}

async function clearPendingRequest() {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_AUTH_COOKIE);
}

export async function approveAuthorizationAction() {
  const pending = await readPendingRequest();
  if (!pending) throw new Error("No authorization request in progress.");

  // Only the signed-in, allow-listed user can grant access.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (!user || (allowedEmail && user.email !== allowedEmail)) {
    throw new Error("Not authorized to grant access.");
  }

  const service = createServiceRoleClient();
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", pending.clientId)
    .maybeSingle();

  if (!client) throw new Error("Unknown client.");
  if (!client.redirect_uris.includes(pending.redirectUri)) {
    throw new Error("redirect_uri does not match a registered value.");
  }
  if (!pending.codeChallenge) throw new Error("Missing PKCE code_challenge.");

  const code = randomToken();
  const { error } = await service.from("mcp_oauth_codes").insert({
    code_hash: hashSecret(code),
    client_id: pending.clientId,
    redirect_uri: pending.redirectUri,
    code_challenge: pending.codeChallenge,
    code_challenge_method: "S256",
    scope: pending.scope,
    user_email: user.email!,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);

  await appendAuditEvent("mcp_client_authorized", {
    client_id: pending.clientId,
    scope: pending.scope,
  });
  await clearPendingRequest();

  const destination = new URL(pending.redirectUri);
  destination.searchParams.set("code", code);
  if (pending.state) destination.searchParams.set("state", pending.state);
  redirect(destination.toString());
}

export async function denyAuthorizationAction() {
  const pending = await readPendingRequest();
  if (!pending) redirect("/");

  const service = createServiceRoleClient();
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("redirect_uris")
    .eq("client_id", pending.clientId)
    .maybeSingle();

  await clearPendingRequest();

  // Only bounce back to a redirect URI the client actually registered.
  if (!client?.redirect_uris.includes(pending.redirectUri)) {
    redirect("/");
  }

  const destination = new URL(pending.redirectUri);
  destination.searchParams.set("error", "access_denied");
  if (pending.state) destination.searchParams.set("state", pending.state);
  redirect(destination.toString());
}
