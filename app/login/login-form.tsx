"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "signing-in" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("signing-in");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      // Supabase returns the same generic error for a bad password and an
      // unknown email, so don't imply which one was wrong.
      setErrorMessage(
        error.message === "Invalid login credentials"
          ? "That email and password combination didn't work."
          : error.message
      );
      return;
    }

    // The session cookie is set by the browser client; refresh so the proxy
    // and server components pick it up on the next request. `next` carries the
    // user back into an in-progress OAuth consent flow; only same-origin
    // relative paths are honored so it can't be used as an open redirect.
    const next = searchParams.get("next");
    const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    router.push(destination);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Charted</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your personal MCP dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {status === "error" && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}

          <Button type="submit" disabled={status === "signing-in"}>
            {status === "signing-in" ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
