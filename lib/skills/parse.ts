export type ParsedSkill = {
  name?: string;
  description?: string;
  /** The SKILL.md body, with any YAML frontmatter removed. */
  body: string;
};

/**
 * Splits a SKILL.md into its frontmatter fields and body.
 *
 * Claude skills carry YAML frontmatter:
 *
 *   ---
 *   name: pdf
 *   description: Use this when the user...
 *   ---
 *   # Instructions...
 *
 * Only `name` and `description` are lifted out, because those are the two
 * fields this form stores separately. The frontmatter is dropped from the body
 * rather than duplicated into it — the tool that serves a skill rebuilds a
 * header from the stored fields.
 */
export function parseSkillMarkdown(raw: string): ParsedSkill {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: text.trim() };

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // Tolerate quoted values, which are common in generated frontmatter.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[kv[1].toLowerCase()] = value;
  }

  return {
    name: fields.name || fields.title || undefined,
    description: fields.description || undefined,
    body: text.slice(match[0].length).trim(),
  };
}

/** Turns a slug-ish frontmatter name into something readable for the Title field. */
export function humanizeSkillName(name: string): string {
  if (name.includes(" ")) return name;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Picks the SKILL.md out of an unzipped bundle. Archives usually nest
 * everything under a top-level folder, so this matches on the filename rather
 * than an exact path, preferring the shallowest match.
 */
export function pickSkillFile(paths: string[]): string | null {
  // macOS zips carry a parallel __MACOSX tree of resource forks whose entries
  // share the real filenames but hold binary junk. Match on any segment, since
  // the folder can sit at any depth.
  const usable = paths.filter(
    (p) => !p.split("/").some((segment) => segment === "__MACOSX" || segment.startsWith("._"))
  );
  const byDepth = (a: string, b: string) => a.split("/").length - b.split("/").length;

  const candidates = usable.filter(
    (p) => (p.split("/").pop()?.toLowerCase() ?? "") === "skill.md"
  );
  if (candidates.length > 0) return candidates.sort(byDepth)[0];

  const anyMd = usable.filter((p) => p.toLowerCase().endsWith(".md"));
  if (anyMd.length === 0) return null;
  return anyMd.sort(byDepth)[0];
}
