"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateWorkspaceBrandingAction } from "@/lib/actions/workspaces";

/**
 * Client component so a failed save renders an explanation in place. As a
 * server-action form this surfaced Next's generic error page instead, which
 * gave no indication of what went wrong.
 */
export function BrandingForm({
  name,
  logoUrl,
  description,
}: {
  name: string;
  logoUrl: string | null;
  description: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState(logoUrl ?? "");

  function handleSubmit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateWorkspaceBrandingAction(formData);
        setSaved(true);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not save branding.";
        // The most likely cause by far is an unrun migration, so say so rather
        // than surfacing a raw Postgres error.
        setError(
          /logo_url|description|column/i.test(message)
            ? `${message} — run db/migrations/0006_workspace_branding.sql in the Supabase SQL editor first.`
            : message
        );
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        {preview ? (
          // Arbitrary external host, so plain <img> rather than next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            className="size-12 shrink-0 rounded-md border object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-secondary text-sm font-medium text-muted-foreground">
            {name.charAt(0)}
          </div>
        )}
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" name="name" defaultValue={name} required />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="logo_url">Logo URL</Label>
        <Input
          id="logo_url"
          name="logo_url"
          type="url"
          defaultValue={logoUrl ?? ""}
          placeholder="https://example.com/logo.png"
          onChange={(e) => setPreview(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Must be https. Shown on the authorization screen, and sent to MCP clients as this
          connector&apos;s icon.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          defaultValue={description ?? ""}
          placeholder="What this workspace is for"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-success">Saved.</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </form>
  );
}
