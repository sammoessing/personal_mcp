"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteMemberAction } from "@/lib/actions/workspaces";

export function InviteForm({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setInviteUrl(null);
    startTransition(async () => {
      try {
        const token = await inviteMemberAction(formData);
        setInviteUrl(`${window.location.origin}/invite/${token}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the invite.");
      }
    });
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={handleSubmit} className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="person@company.com" />
        </div>
        <div className="flex w-36 flex-col gap-1.5">
          <Label htmlFor="role">Role</Label>
          <select
            id="role"
            name="role"
            defaultValue="member"
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create invite"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {inviteUrl && (
        <div className="rounded-md border bg-secondary/40 p-3">
          <p className="mb-2 text-xs font-medium">
            Invite link for {workspaceName} — send this to them yourself
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{inviteUrl}</code>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleCopy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Valid for 7 days. It is shown once — create a new invite if you lose it.
          </p>
        </div>
      )}
    </div>
  );
}
