export type DocKind = "context" | "knowledge";
export type DocScope = "user" | "team" | "company";
export type DocReviewState = "draft" | "pending" | "approved";

export type BrainDoc = {
  id: string;
  slug: string;
  title: string;
  /** When an agent should reach for this doc — the retrieval trigger, not a summary. */
  description: string | null;
  kind: DocKind;
  scope: DocScope;
  folder_id: string | null;
  /** The file this document was imported from, kept so nothing is lost to extraction. */
  source_file_id: string | null;
  content: string;
  status: "active" | "archived";
  review_state: DocReviewState;
  mcp_exposed: boolean;
  created_at: string;
  updated_at: string;
};

export type BrainFolder = {
  id: string;
  path: string;
};

export const DOC_KINDS: DocKind[] = ["context", "knowledge"];
export const DOC_SCOPES: DocScope[] = ["user", "team", "company"];
export const DOC_REVIEW_STATES: DocReviewState[] = ["draft", "pending", "approved"];

export const KIND_DESCRIPTION: Record<DocKind, string> = {
  context: "Standing instructions — merged into every agent session.",
  knowledge: "Reference material — retrieved on demand by search.",
};

/** First ~160 chars of body text, with markdown headings/formatting stripped. */
export function snippetOf(content: string, length = 160): string {
  const flat = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

/**
 * Manifest-style wiki-links: [[doc-slug]] cross-references another brain doc.
 * Returns the slugs referenced by a document body.
 */
export function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([a-z0-9-]+)\]\]/gi);
  return [...new Set([...matches].map((m) => m[1].toLowerCase()))];
}
