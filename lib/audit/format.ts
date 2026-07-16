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
    default:
      return eventType;
  }
}
