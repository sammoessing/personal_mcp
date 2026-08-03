"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AcceptInviteForm({
  token,
  email,
  workspaceName,
}: {
  token: string;
  email: string;
  workspaceName: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("working");
    setMessage("");

    const supabase = createClient();

    // Existing account? Sign in. Otherwise create one for this exact address —
    // the email comes from the invite row, not from user input, so an invite
    // can only ever create the account it was addressed to.
    let signedIn = false;
    const signIn = await supabase.auth.signInWithPassword({ email, password });
    if (!signIn.error) {
      signedIn = true;
    } else {
      const signUp = await supabase.auth.signUp({ email, password });
      if (signUp.error) {
        setStatus("error");
        setMessage(signUp.error.message);
        return;
      }
      signedIn = !!signUp.data.session;
    }

    if (!signedIn) {
      setStatus("error");
      setMessage("Account created, but email confirmation is required. Ask your admin to confirm it.");
      return;
    }

    const res = await fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus("error");
      setMessage(body.error ?? "Could not join the workspace.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-sm font-semibold">M</span>
          </div>
          <h1 className="text-lg font-semibold">Join {workspaceName}</h1>
          <p className="text-sm text-muted-foreground">
            Set a password for <span className="font-medium text-foreground">{email}</span>.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. If you already have an account, enter its password.
            </p>
          </div>

          {status === "error" && <p className="text-sm text-destructive">{message}</p>}

          <Button type="submit" disabled={status === "working"}>
            {status === "working" ? "Joining…" : "Join workspace"}
          </Button>
        </form>
      </div>
    </div>
  );
}
