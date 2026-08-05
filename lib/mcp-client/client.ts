/**
 * A minimal MCP client over Streamable HTTP.
 *
 * The official SDK's client is written for a long-lived process holding an
 * open session. Each request here is a short serverless invocation, so this
 * runs the handshake and the call together and drops the session afterwards —
 * simpler than trying to keep a session alive across invocations that may not
 * even land on the same machine.
 */

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
};

export type RemoteTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
};

/** Raised when the server rejects our credentials, so callers can prompt a reconnect. */
export class McpUnauthorizedError extends Error {
  constructor(message = "The remote server rejected this connection's token.") {
    super(message);
    this.name = "McpUnauthorizedError";
  }
}

/**
 * A Streamable HTTP response is either JSON or an SSE stream carrying the same
 * JSON-RPC messages. Both shapes have to be accepted; servers choose freely.
 */
async function readRpc(response: Response): Promise<JsonRpcResponse | null> {
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!body) return null;

  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(body) as JsonRpcResponse;
  }

  // Take the last `data:` payload that parses as a JSON-RPC response.
  let found: JsonRpcResponse | null = null;
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      if (parsed.result !== undefined || parsed.error !== undefined) found = parsed;
    } catch {
      // Partial or non-JSON events are not ours to interpret.
    }
  }
  return found;
}

export class RemoteMcpSession {
  private sessionId: string | null = null;
  private readonly url: string;
  private readonly accessToken: string;

  // Explicit fields rather than constructor parameter properties: those are a
  // TypeScript-only construct that type-stripping runtimes reject.
  constructor(url: string, accessToken: string) {
    this.url = url;
    this.accessToken = accessToken;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      Authorization: `Bearer ${this.accessToken}`,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async send(
    method: string,
    params: unknown,
    id: number | null
  ): Promise<JsonRpcResponse | null> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(
        id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }
      ),
    });

    if (response.status === 401 || response.status === 403) {
      throw new McpUnauthorizedError();
    }

    // The session id arrives on the initialize response and must be echoed on
    // every subsequent request in the same session.
    const issued = response.headers.get("mcp-session-id");
    if (issued) this.sessionId = issued;

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Remote MCP server error (HTTP ${response.status}). ${detail.slice(0, 200)}`);
    }

    return readRpc(response);
  }

  async initialize(): Promise<void> {
    const result = await this.send(
      "initialize",
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Charted", version: "0.1.0" },
      },
      1
    );
    if (result?.error) throw new Error(result.error.message);
    // Required by the spec before any other request is served.
    await this.send("notifications/initialized", {}, null);
  }

  async listTools(): Promise<RemoteTool[]> {
    const response = await this.send("tools/list", {}, 2);
    if (response?.error) throw new Error(response.error.message);
    const tools = (response?.result as { tools?: RemoteTool[] } | undefined)?.tools;
    return tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.send("tools/call", { name, arguments: args }, 3);
    if (response?.error) throw new Error(response.error.message);

    const result = response?.result as
      | { content?: Array<{ type: string; text?: string }>; isError?: boolean }
      | undefined;

    const text = (result?.content ?? [])
      .map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`))
      .join("\n")
      .trim();

    if (result?.isError) throw new Error(text || "The remote tool reported an error.");
    return text || "(the tool returned no content)";
  }
}

/** Runs the handshake and hands back a ready session. */
export async function openSession(url: string, accessToken: string): Promise<RemoteMcpSession> {
  const session = new RemoteMcpSession(url, accessToken);
  await session.initialize();
  return session;
}
