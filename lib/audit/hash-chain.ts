import { createServiceRoleClient } from "@/lib/supabase/server";

export type AuditEventType =
  | "tool_call"
  | "connector_connected"
  | "connector_disconnected"
  | "skill_created"
  | "skill_status_changed"
  | "skill_mcp_exposure_changed"
  | "brain_doc_created"
  | "brain_doc_updated"
  | "brain_doc_review_changed"
  | "brain_doc_deleted"
  | "brain_folder_created"
  | "mcp_client_authorized";

/**
 * Appends a row to the hash chain via the append_audit_event() Postgres
 * function, which serializes concurrent writers with an advisory lock and
 * computes the hash server-side so the chain can't fork.
 */
export async function appendAuditEvent(
  eventType: AuditEventType,
  payload: Record<string, unknown>
) {
  const supabase = createServiceRoleClient();
  const payloadJson = JSON.stringify(payload);

  const { data, error } = await supabase
    .rpc("append_audit_event", {
      p_event_type: eventType,
      p_payload_json: payloadJson,
    })
    .single<{ seq: number; hash: string }>();

  if (error) throw error;
  return data;
}

export async function verifyAuditChain() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .rpc("verify_audit_chain")
    .single<{ verified: boolean; broken_at_seq: number | null; total_rows: number }>();

  if (error) throw error;
  return data;
}
