"use server";

import { verifyAuditChain } from "@/lib/audit/hash-chain";

export async function verifyAuditChainAction() {
  return verifyAuditChain();
}
