"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Topbar({ email }: { email: string }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = email.charAt(0).toUpperCase();

  return (
    <div className="flex h-14 shrink-0 items-center justify-end gap-3 border-b px-6">
      <span className="text-sm text-muted-foreground">{email}</span>
      <Avatar className="size-7">
        <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">
          {initial}
        </AvatarFallback>
      </Avatar>
      <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out">
        <LogOut className="size-4" />
      </Button>
    </div>
  );
}
