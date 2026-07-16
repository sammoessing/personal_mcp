import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { CONNECTOR_REGISTRY, isConnectorConfigured, type ConnectorProvider } from "@/lib/connectors/registry";
import { buildAuthorizeUrl } from "@/lib/connectors/oauth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!(provider in CONNECTOR_REGISTRY)) {
    return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
  }
  const typedProvider = provider as ConnectorProvider;

  if (!isConnectorConfigured(typedProvider)) {
    return NextResponse.json(
      { error: `${provider} OAuth app is not configured. Set its client id/secret env vars.` },
      { status: 400 }
    );
  }

  const state = randomBytes(24).toString("hex");
  const { origin } = new URL(request.url);
  const authorizeUrl = buildAuthorizeUrl(typedProvider, origin, state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(`oauth_state_${provider}`, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
