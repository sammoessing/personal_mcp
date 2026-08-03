import { google } from "googleapis";
import { getConnectorAccessToken } from "./tokens";

/** Google Calendar and Gmail share one Google Cloud OAuth app (see registry.ts), but hold separate tokens per connector row. */
export async function googleAuth(workspaceId: string, provider: "google_calendar" | "gmail") {
  const token = await getConnectorAccessToken(workspaceId, provider);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return auth;
}
