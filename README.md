# Manifest — multi-workspace MCP dashboard

A dashboard that exposes a real MCP server (`/api/mcp`) over Streamable HTTP, lets each workspace
connect its own tools (GitHub, Linear, Google Calendar, Gmail, Notion, Slack, Discord) via live
OAuth, hosts a Brain of context/knowledge docs and a library of Claude Skills, and keeps a
tamper-evident, hash-chained audit log of every tool call and workflow event.

## Workspaces and isolation

Each client company is a **workspace** with its own brain docs, skills, connectors, credentials,
audit chain, and members. Isolation is enforced in two independent layers:

1. **Row-level security.** Every tenant table carries a `workspace_id`, and its policy admits a row
   only when `is_workspace_member(workspace_id)` holds for the requesting user. A bug in the
   application cannot leak across tenants for dashboard traffic — Postgres refuses the rows.
2. **Token-bound MCP.** Each OAuth access token is bound to exactly one workspace at consent time,
   after the server re-checks membership. Tool handlers read the workspace from the verified token
   and never from tool arguments, so a client cannot name a workspace it wasn't granted.

Audit chains are per-workspace, so verifying one tenant's trail never reads another's rows. Skill
and doc slugs are unique per workspace rather than globally.

Members are invite-only: an admin creates an invite, and the link only works for the email address
it was issued to. Set `RESEND_API_KEY` and `EMAIL_FROM` to have invitations emailed automatically —
the sending domain must be verified in Resend, and until it is, Resend will only deliver to your own
account address. Without those variables invites still work; the Members page just shows a link to
send yourself. A `member` can read approved content and propose changes; `admin`/`owner` approve
them and manage membership.

## Stack

Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres + Auth), deployed on Vercel.
MCP is served via [`mcp-handler`](https://www.npmjs.com/package/mcp-handler) and the official
`@modelcontextprotocol/sdk`.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `db/migrations/0001_init.sql`. It creates all tables, the
   `append_audit_event` / `verify_audit_chain` functions that power the hash-chained audit trail,
   RLS policies, and seeds the 7 connector rows.
   Then run the remaining migrations in order: `0002_brain.sql` (the Brain, plus skill
   visibility/usage columns), `0003_lock_down_rpc.sql` (revokes public EXECUTE on the
   SECURITY DEFINER functions), `0004_mcp_oauth.sql` (the OAuth server's client/code/token
   tables), `0005_workspaces.sql` (workspaces, membership, invites, and per-tenant RLS),
   `0006_workspace_branding.sql` (per-workspace logo and description), and
   `0007_fix_digest_search_path.sql` (lets the audit functions resolve pgcrypto's digest()).
3. Under **Authentication → Providers**, make sure **Email** is enabled.
4. Create your own account: **Authentication → Users → Add user**, choose a password, and tick
   **Auto Confirm User**. Migration `0005` makes that address an owner of every workspace.
   Everyone else joins by invite from the Members page — there is no public sign-up.
5. Copy the Project URL, `anon` key, and `service_role` key into your env file (see below).

## 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — from
  your Supabase project settings.
- `TOKEN_ENCRYPTION_KEY` — random secret used to encrypt connector OAuth tokens at rest. Generate
  with `openssl rand -base64 32`.
- `MCP_ACCESS_TOKEN` — bearer token your MCP clients (Claude Desktop, Claude Code, etc.) send back
  to authenticate. Generate with `openssl rand -hex 32`.
- `RESEND_API_KEY` / `EMAIL_FROM` — optional; enables invitation emails. See the note under
  Workspaces and isolation for the domain-verification caveat.
- One `_CLIENT_ID` / `_CLIENT_SECRET` pair per connector you want live. Each connector's "Connect"
  button on `/connections` stays disabled until both of its env vars are set, so you can wire these
  up incrementally rather than all at once. `.env.example` lists where to register each OAuth app
  and which redirect URI to give it (`<your-domain>/api/connectors/<provider>/callback`).

## 3. Run locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, sign in with the email and password you created above, and the dashboard
loads. The MCP endpoint is at `http://localhost:3000/api/mcp`.

## 4. Deploy

1. Push this repo to GitHub and import it into [Vercel](https://vercel.com/new).
2. Add all the env vars from step 2 to the Vercel project (Production + Preview).
3. Deploy. Your MCP endpoint is now `https://<your-domain>/api/mcp` — it's shown on the Overview
   page and the MCP Gateway page with a copy button.
4. Update each connector's OAuth app redirect URI to use your real domain instead of localhost.

### Connecting an MCP client

**claude.ai (browser)** — add a custom connector pointing at `https://<your-domain>/api/mcp` and
click Connect. It registers itself via Dynamic Client Registration, sends you to a consent screen
on your own dashboard, and receives an OAuth token. No token to copy.

**Claude Desktop / Claude Code** — paste the static token instead:

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

### How MCP auth works

The endpoint accepts two credentials: an OAuth access token issued by this app's own
authorization server (`lib/oauth/`, `app/api/oauth/`, `app/oauth/authorize`), or the static
`MCP_ACCESS_TOKEN`. Browser clients can't hold a static secret, so they run the OAuth flow:
discovery via `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`,
Dynamic Client Registration (RFC 7591), then authorization-code with mandatory PKCE S256.
Authorization codes are single-use and replaying one revokes the tokens it produced. Codes and
tokens are stored only as SHA-256 hashes.

## How it's organized

- `app/(dashboard)/` — Overview, Skills, Brain, MCP Gateway, Connections, Vault, Audit pages.
- `lib/brain/` + `lib/mcp/tools/brain.ts` — the Brain: a folder-organised doc library. Each doc is
  either **context** (standing instructions) or **knowledge** (reference material), scoped
  user/team/company and gated by a review state. Only `approved` + `mcp_exposed` docs are served
  over MCP. `brain_context_get` merges every approved context doc with provenance headers so a
  client can load your standing instructions in one call.
- `app/api/[transport]/route.ts` — the MCP server endpoint (`/api/mcp`), bearer-token gated.
- `app/api/connectors/[provider]/{authorize,callback,disconnect}` — OAuth flow per connector.
- `lib/connectors/` — one file per connector: its OAuth token handling and its MCP tools.
- `lib/mcp/` — tool registry, usage-tracking middleware, and MCP server wiring.
- `lib/audit/hash-chain.ts` — appends to and verifies the hash-chained `audit_log` table.
- `db/migrations/0001_init.sql` — full schema, RLS policies, and the audit-chain SQL functions.

Every MCP tool call — built-in or connector-backed — is wrapped by
`lib/mcp/usage-middleware.ts`, which records it in `tool_calls` (for the Audit page's usage
breakdown) and appends a row to the hash chain (for the Audit page's verified feed).
