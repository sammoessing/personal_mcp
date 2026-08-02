"use server";

import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  hashSecret,
  randomToken,
  AUTH_CODE_TTL_SECONDS,
} from "@/lib/oauth/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";

/**
 * Completes the authorization step: mints a single-use code bound to the
 * client, the redirect URI, and the PKCE challenge, then bounces the browser
 * back to the client.
 *
 * Re-validates everything server-side rather than trusting the form fields,
 * since a form post is fully attacker-controllable.
 */
export async function approveAuthorizationAction(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const state = String(formData.get("state") ?? "");
  const scope = String(formData.get("scope") ?? "mcp");

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
    .eq("client_id", clientId)
    .maybeSingle();

  if (!client) throw new Error("Unknown client.");
  if (!client.redirect_uris.includes(redirectUri)) {
    throw new Error("redirect_uri does not match a registered value.");
  }
  if (!codeChallenge) throw new Error("Missing PKCE code_challenge.");

  const code = randomToken();
  const { error } = await service.from("mcp_oauth_codes").insert({
    code_hash: hashSecret(code),
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope,
    user_email: user.email!,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);

  await appendAuditEvent("mcp_client_authorized", { client_id: clientId, scope });

  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code);
  if (state) destination.searchParams.set("state", state);
  redirect(destination.toString());
}

export async function denyAuthorizationAction(formData: FormData) {
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
  const clientId = String(formData.get("client_id") ?? "");

  const service = createServiceRoleClient();
  const { data: client } = await service
    .from("mcp_oauth_clients")
    .select("redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();

  // Only bounce back to a redirect URI the client actually registered.
  if (!client?.redirect_uris.includes(redirectUri)) {
    redirect("/");
  }

  const destination = new URL(redirectUri);
  destination.searchParams.set("error", "access_denied");
  if (state) destination.searchParams.set("state", state);
  redirect(destination.toString());
}
