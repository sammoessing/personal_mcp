# Manifest — personal MCP dashboard

A single-user dashboard that exposes a real MCP server (`/api/mcp`) over Streamable HTTP, lets you
connect the tools you use day to day (GitHub, Linear, Google Calendar, Gmail, Notion, Slack,
Discord) via live OAuth, hosts a library of Claude Skills you develop over time, and keeps a
tamper-evident, hash-chained audit log of every tool call and workflow event.

## Stack

Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres + Auth), deployed on Vercel.
MCP is served via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) and the official
`@modelcontextprotocol/sdk`.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `db/migrations/0001_init.sql`. It creates all tables, the
   `append_audit_event` / `verify_audit_chain` functions that power the hash-chained audit trail,
   RLS policies, and seeds the 7 connector rows.
3. Under **Authentication → Providers**, make sure Email (magic link) is enabled.
4. Copy the Project URL, `anon` key, and `service_role` key into your env file (see below).

## 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — from
  your Supabase project settings.
- `ALLOWED_EMAIL` — the only email allowed to sign in (this is a single-user app).
- `TOKEN_ENCRYPTION_KEY` — random secret used to encrypt connector OAuth tokens at rest. Generate
  with `openssl rand -base64 32`.
- `MCP_ACCESS_TOKEN` — bearer token your MCP clients (Claude Desktop, Claude Code, etc.) send back
  to authenticate. Generate with `openssl rand -hex 32`.
- One `_CLIENT_ID` / `_CLIENT_SECRET` pair per connector you want live. Each connector's "Connect"
  button on `/connections` stays disabled until both of its env vars are set, so you can wire these
  up incrementally rather than all at once. `.env.example` lists where to register each OAuth app
  and which redirect URI to give it (`<your-domain>/api/connectors/<provider>/callback`).

## 3. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, sign in with a magic link sent to `ALLOWED_EMAIL`, and the dashboard
loads. The MCP endpoint is at `http://localhost:3000/api/mcp`.

## 4. Deploy

1. Push this repo to GitHub and import it into [Vercel](https://vercel.com/new).
2. Add all the env vars from step 2 to the Vercel project (Production + Preview).
3. Deploy. Your MCP endpoint is now `https://<your-domain>/api/mcp` — it's shown on the Overview
   page and the MCP Gateway page with a copy button.
4. Update each connector's OAuth app redirect URI to use your real domain instead of localhost.

### Connecting an MCP client

```json
{
  "mcpServers": {
    "manifest": {
      "url": "https://<your-domain>/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_ACCESS_TOKEN>"
      }
    }
  }
}
```

## How it's organized

- `app/(dashboard)/` — Overview, Skills, Brain, MCP Gateway, Connections, Vault, Audit pages.
- `app/api/[transport]/route.ts` — the MCP server endpoint (`/api/mcp`), bearer-token gated.
- `app/api/connectors/[provider]/{authorize,callback,disconnect}` — OAuth flow per connector.
- `lib/connectors/` — one file per connector: its OAuth token handling and its MCP tools.
- `lib/mcp/` — tool registry, usage-tracking middleware, and MCP server wiring.
- `lib/audit/hash-chain.ts` — appends to and verifies the hash-chained `audit_log` table.
- `db/migrations/0001_init.sql` — full schema, RLS policies, and the audit-chain SQL functions.

Every MCP tool call — built-in or connector-backed — is wrapped by
`lib/mcp/usage-middleware.ts`, which records it in `tool_calls` (for the Audit page's usage
breakdown) and appends a row to the hash chain (for the Audit page's verified feed).
