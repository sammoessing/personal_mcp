import { createServiceRoleClient } from "@/lib/supabase/server";
import { decrypt, redact } from "@/lib/crypto";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyRound } from "lucide-react";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

function safeRedact(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    return redact(decrypt(enc));
  } catch {
    return "unavailable (check TOKEN_ENCRYPTION_KEY)";
  }
}

type OAuthTokenRow = {
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
};

export default async function VaultPage() {
  const supabase = createServiceRoleClient();
  const { data: rows } = await supabase
    .from("connectors")
    .select(
      "provider, status, connected_at, oauth_tokens(access_token_enc, refresh_token_enc, expires_at)"
    )
    .order("provider");

  return (
    <>
      <PageHeader
        title="Vault"
        description="Encrypted OAuth credentials for each connector — tokens are AES-256-GCM encrypted at rest and never shown in full."
      />
      <Card className="p-0">
        <div className="divide-y">
          {(rows ?? []).map((row) => {
            const provider = row.provider as ConnectorProvider;
            const def = CONNECTOR_REGISTRY[provider];
            const tokenRowRaw = row.oauth_tokens as unknown;
            const tokenRow = (Array.isArray(tokenRowRaw) ? tokenRowRaw[0] : tokenRowRaw) as
              | OAuthTokenRow
              | null
              | undefined;

            return (
              <div key={provider} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <KeyRound className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{def.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {tokenRow
                        ? `access ${safeRedact(tokenRow.access_token_enc)}${
                            tokenRow.refresh_token_enc
                              ? ` · refresh ${safeRedact(tokenRow.refresh_token_enc)}`
                              : ""
                          }`
                        : "No credentials stored"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  {row.connected_at && <span>connected {timeAgo(row.connected_at)} ago</span>}
                  {tokenRow?.expires_at && <span>expires {timeAgo(tokenRow.expires_at)}</span>}
                  <Badge
                    variant={
                      row.status === "connected"
                        ? "success"
                        : row.status === "error"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {row.status}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
