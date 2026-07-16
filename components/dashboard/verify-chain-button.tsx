"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, ShieldAlert, RotateCw } from "lucide-react";
import { verifyAuditChainAction } from "@/lib/actions/audit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type VerifyResult = {
  verified: boolean;
  broken_at_seq: number | null;
  total_rows: number;
};

export function VerifyChainButton({ initial }: { initial: VerifyResult }) {
  const [result, setResult] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function handleVerify() {
    startTransition(async () => {
      const next = await verifyAuditChainAction();
      setResult(next);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={result.verified ? "success" : "destructive"} className="gap-1.5">
        {result.verified ? <ShieldCheck className="size-3" /> : <ShieldAlert className="size-3" />}
        {result.verified ? "Verified · hash-chained" : `Broken at seq ${result.broken_at_seq}`}
      </Badge>
      <Button variant="ghost" size="icon" onClick={handleVerify} disabled={isPending} title="Re-verify chain">
        <RotateCw className={`size-3.5 ${isPending ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
