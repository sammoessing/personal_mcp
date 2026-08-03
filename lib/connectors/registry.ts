export type ConnectorProvider =
  | "github"
  | "linear"
  | "google_calendar"
  | "gmail"
  | "notion"
  | "slack"
  | "discord";

/**
 * Who a connection belongs to.
 *
 * `workspace` — one shared connection the whole workspace uses. Right for
 *   org-level accounts: a Slack workspace, a Notion teamspace, a GitHub org.
 * `member` — each person connects their own account, and nobody else in the
 *   workspace can read it. Right for personal accounts, where a shared
 *   connection would quietly hand your inbox to your colleagues.
 */
export type ConnectorScope = "workspace" | "member";

export type ConnectorDefinition = {
  provider: ConnectorProvider;
  displayName: string;
  description: string;
  scope: ConnectorScope;
  /** OAuth scopes requested during authorize. */
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  /** Env var names for this connector's OAuth app credentials. */
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Shared client id/secret with another connector (Calendar + Gmail both use Google's OAuth app). */
  sharesCredentialsWith?: ConnectorProvider;
};

/**
 * Single source of truth for the 7 supported connectors: OAuth endpoints,
 * scopes, and which env vars hold the client id/secret. Used by the
 * Connections page, the OAuth authorize/callback routes, and each
 * connector's MCP tools.
 */
export const CONNECTOR_REGISTRY: Record<ConnectorProvider, ConnectorDefinition> = {
  github: {
    provider: "github",
    displayName: "GitHub",
    description: "Repos, issues, and pull requests.",
    scope: "workspace",
    scopes: ["repo", "read:org", "read:user"],
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
  },
  linear: {
    provider: "linear",
    displayName: "Linear",
    description: "Issues and projects.",
    scope: "workspace",
    scopes: ["read", "write"],
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    clientIdEnv: "LINEAR_CLIENT_ID",
    clientSecretEnv: "LINEAR_CLIENT_SECRET",
  },
  google_calendar: {
    provider: "google_calendar",
    displayName: "Google Calendar",
    description: "Events and scheduling.",
    scope: "member",
    scopes: ["https://www.googleapis.com/auth/calendar"],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
  gmail: {
    provider: "gmail",
    displayName: "Gmail",
    description: "Read and search email.",
    scope: "member",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    sharesCredentialsWith: "google_calendar",
  },
  notion: {
    provider: "notion",
    displayName: "Notion",
    description: "Pages and databases.",
    scope: "workspace",
    scopes: [],
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
  },
  slack: {
    provider: "slack",
    displayName: "Slack",
    description: "Channels and messages.",
    scope: "workspace",
    scopes: ["channels:read", "chat:write", "users:read"],
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
  },
  discord: {
    provider: "discord",
    displayName: "Discord",
    description: "Servers and messages.",
    scope: "member",
    scopes: ["identify", "guilds"],
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    clientIdEnv: "DISCORD_CLIENT_ID",
    clientSecretEnv: "DISCORD_CLIENT_SECRET",
  },
};

export const CONNECTOR_LIST = Object.values(CONNECTOR_REGISTRY);

/**
 * The env vars that actually hold a connector's credentials, following
 * `sharesCredentialsWith` — Gmail and Calendar are one Google OAuth app, so
 * both resolve to GOOGLE_CLIENT_ID/SECRET rather than a name derived from the
 * provider.
 */
export function connectorCredentialEnv(provider: ConnectorProvider): {
  clientIdEnv: string;
  clientSecretEnv: string;
} {
  const def = CONNECTOR_REGISTRY[provider];
  const source = def.sharesCredentialsWith
    ? CONNECTOR_REGISTRY[def.sharesCredentialsWith]
    : def;
  return { clientIdEnv: source.clientIdEnv, clientSecretEnv: source.clientSecretEnv };
}

export function isConnectorConfigured(provider: ConnectorProvider): boolean {
  const { clientIdEnv, clientSecretEnv } = connectorCredentialEnv(provider);
  return Boolean(process.env[clientIdEnv] && process.env[clientSecretEnv]);
}
