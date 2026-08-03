import { google } from "googleapis";
import { getConnectorAccessToken, type ConnectorActor } from "./tokens";

/** Google Calendar and Gmail share one Google Cloud OAuth app (see registry.ts), but hold separate tokens per connector row. */
export async function googleAuth(actor: ConnectorActor, provider: "google_calendar" | "gmail") {
  const token = await getConnectorAccessToken(actor, provider);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return auth;
}
