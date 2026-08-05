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
    case "brain_file_uploaded":
      return `File "${payload.name}" uploaded`;
    case "brain_file_downloaded":
      return `File "${payload.name}" downloaded`;
    case "brain_file_deleted":
      return `File "${payload.name}" deleted`;
    case "brain_file_updated":
      return `File "${payload.name}" details updated`;
    case "brain_file_moved":
      return `File "${payload.name}" moved to ${payload.folder}`;
    case "brain_folder_created":
      return `Brain folder "${payload.path}" created`;
    case "mcp_server_added":
      return `External MCP server "${payload.name}" added`;
    case "mcp_server_removed":
      return `External MCP server "${payload.name}" removed`;
    case "mcp_server_connected":
      return `Connected to "${payload.name}"`;
    case "mcp_server_disconnected":
      return `Disconnected from "${payload.name}"`;
    case "mcp_client_authorized":
      return `MCP client authorized (${payload.client_id})`;
    default:
      return eventType;
  }
}
