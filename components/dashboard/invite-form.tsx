"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, MailCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteMemberAction, type InviteResult } from "@/lib/actions/workspaces";

export function InviteForm({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<(InviteResult & { email: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      try {
        const invite = await inviteMemberAction(formData);
        setResult({ ...invite, email });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the invite.");
      }
    });
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl);
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
          {isPending ? "Sending…" : "Send invite"}
        </Button>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {result?.emailed && (
        <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Invitation emailed to {result.email}</p>
            <p className="mt-0.5 text-xs">
              Valid for 7 days, and only usable by that address.
            </p>
          </div>
        </div>
      )}

      {result && !result.emailed && (
        <div className="rounded-md border bg-secondary/40 p-3">
          <div className="mb-2 flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-foreground">
                Invite created, but the email wasn&apos;t sent
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {result.emailError} Send this link to {result.email} yourself — the invitation
                itself is valid.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{result.inviteUrl}</code>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleCopy}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Invitations to {workspaceName} are single-use and tied to the address they&apos;re sent to.
      </p>
    </div>
  );
}
