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
  | "brain_doc_archived"
  | "brain_doc_moved"
  | "brain_folder_created"
  | "mcp_client_authorized"
  | "member_invited"
  | "member_joined"
  | "member_removed";

/**
 * Appends a row to a workspace's hash chain via append_audit_event(), which
 * serializes concurrent writers with a per-workspace advisory lock and computes
 * the hash server-side so a chain can't fork. Each workspace has its own chain,
 * so verifying one tenant's trail never reads another's rows.
 */
export async function appendAuditEvent(
  workspaceId: string,
  eventType: AuditEventType,
  payload: Record<string, unknown>
) {
  const supabase = createServiceRoleClient();
  const payloadJson = JSON.stringify(payload);

  const { data, error } = await supabase
    .rpc("append_audit_event", {
      p_workspace_id: workspaceId,
      p_event_type: eventType,
      p_payload_json: payloadJson,
    })
    .single<{ seq: number; hash: string }>();

  if (error) throw error;
  return data;
}

export async function verifyAuditChain(workspaceId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .rpc("verify_audit_chain", { p_workspace_id: workspaceId })
    .single<{ verified: boolean; broken_at_seq: number | null; total_rows: number }>();

  if (error) throw error;
  return data;
}
