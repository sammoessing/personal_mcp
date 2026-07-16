import type { z } from "zod";
import type { ConnectorProvider } from "@/lib/connectors/registry";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  /** Omitted for built-in tools that aren't backed by a connector. */
  connector?: ConnectorProvider;
  inputSchema: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResult>;
};

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
