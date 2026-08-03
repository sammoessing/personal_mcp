"use server";

import { verifyAuditChain } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace } from "@/lib/workspace/context";

export async function verifyAuditChainAction() {
  const ws = await requireCurrentWorkspace();
  return verifyAuditChain(ws.id);
}
