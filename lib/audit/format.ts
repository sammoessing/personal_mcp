export function eventLabel(eventType: string, payload: Record<string, unknown>): string {
  switch (eventType) {
    case "tool_call":
      return `${payload.tool} invoked${payload.connector ? ` via ${payload.connector}` : ""}`;
    case "connector_connected":
      return `${payload.provider} connected`;
    case "connector_disconnected":
      return `${payload.provider} disconnected`;
    case "skill_created":
      return `Skill "${payload.name}" created`;
    case "skill_status_changed":
      return `Skill "${payload.name}" set to ${payload.status}`;
    case "skill_mcp_exposure_changed":
      return `Skill "${payload.name}" ${payload.exposed ? "exposed to" : "hidden from"} MCP`;
    case "brain_doc_created":
      return `Brain doc "${payload.title}" created`;
    case "brain_doc_updated":
      return `Brain doc "${payload.title}" updated`;
    case "brain_doc_review_changed":
      return `Brain doc "${payload.title}" ${payload.reviewState}`;
    case "brain_doc_deleted":
      return `Brain doc "${payload.title}" deleted`;
    case "brain_doc_archived":
      return `Brain doc "${payload.title}" archived`;
    case "brain_doc_moved":
      return `Brain doc "${payload.title}" moved to ${payload.folder}`;
    case "brain_folder_created":
      return `Brain folder "${payload.path}" created`;
    case "mcp_client_authorized":
      return `MCP client authorized (${payload.client_id})`;
    default:
      return eventType;
  }
}
