"use client";

import { useState } from "react";
import { Copy, Check, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Renders a ready-to-paste MCP client config (Claude Desktop / Code style)
 * for the site owner. The bearer token is masked by default — this page is
 * gated to the single allowed user, but masking avoids shoulder-surfing and
 * accidental exposure in screenshots.
 */
export function McpClientConfig({ url, token }: { url: string; token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasToken = token.length > 0;
  const displayToken = hasToken
    ? revealed
      ? token
      : "•".repeat(Math.min(token.length, 40))
    : "SET_MCP_ACCESS_TOKEN_IN_ENV";

  const configObject = {
    mcpServers: {
      charted: {
        url,
        headers: {
          Authorization: `Bearer ${hasToken ? token : "<MCP_ACCESS_TOKEN>"}`,
        },
      },
    },
  };
  const fullConfig = JSON.stringify(configObject, null, 2);
  const displayConfig = fullConfig.replace(token, displayToken);

  async function handleCopy() {
    await navigator.clipboard.writeText(fullConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-md border bg-secondary/40">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          MCP client config
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setRevealed((v) => !v)}
            disabled={!hasToken}
            title={revealed ? "Hide token" : "Reveal token"}
          >
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleCopy}
            title="Copy config (with real token)"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-xs leading-relaxed">
        <code>{displayConfig}</code>
      </pre>
    </div>
  );
}
