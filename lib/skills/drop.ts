import { unzipSync, strFromU8 } from "fflate";
import { pickSkillFile } from "@/lib/skills/parse";

/**
 * A dropped skill can arrive in three shapes, and all three are things people
 * actually have on disk after downloading one:
 *
 *   1. a bare SKILL.md
 *   2. a .zip bundle
 *   3. an unzipped *folder* — the common case, and the one that fails silently
 *      if you only look at `dataTransfer.files`, because a directory entry
 *      there is not a readable file
 *
 * This module normalises all three down to markdown text.
 */

export type DropSnapshot = {
  entries: FileSystemEntry[];
  files: File[];
};

/**
 * `DataTransfer.items` is only valid for the duration of the drop handler, so
 * the entries have to be pulled out synchronously — before the first `await`.
 * Everything else can happen at leisure against this snapshot.
 */
export function snapshotDrop(dataTransfer: DataTransfer): DropSnapshot {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  return { entries, files: Array.from(dataTransfer.files ?? []) };
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** `readEntries` returns at most ~100 per call, so it has to be drained. */
function readDir(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  return new Promise((resolve, reject) => {
    const found: FileSystemEntry[] = [];
    const step = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(found);
          return;
        }
        found.push(...batch);
        step();
      }, reject);
    step();
  });
}

/**
 * Walks dropped directory entries into a path → file map. Depth is bounded
 * because a skill bundle is shallow and a mis-drop of a home directory should
 * not turn into an unbounded traversal.
 */
async function collectEntries(
  entries: FileSystemEntry[],
  maxDepth = 5
): Promise<Map<string, FileSystemFileEntry>> {
  const files = new Map<string, FileSystemFileEntry>();
  let level = entries;

  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: FileSystemEntry[] = [];
    for (const entry of level) {
      if (entry.isFile) {
        files.set(entry.fullPath.replace(/^\//, ""), entry as FileSystemFileEntry);
      } else if (entry.isDirectory && depth < maxDepth) {
        next.push(...(await readDir(entry as FileSystemDirectoryEntry)));
      }
    }
    level = next;
  }

  return files;
}

async function markdownFromZip(file: File): Promise<string> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const target = pickSkillFile(Object.keys(entries));
  if (!target) throw new Error("That archive doesn't contain a SKILL.md.");
  return strFromU8(entries[target]);
}

const isZip = (name: string) => name.toLowerCase().endsWith(".zip");

/**
 * Resolves a drop to `{ markdown, label }`, or throws an `Error` whose message
 * is safe to show as-is — the failure modes here are all things the person can
 * act on ("that folder has no SKILL.md"), so they are worth naming precisely.
 */
export async function readSkillFromDrop(
  snapshot: DropSnapshot
): Promise<{ markdown: string; label: string }> {
  const directories = snapshot.entries.filter((entry) => entry.isDirectory);

  if (directories.length > 0) {
    const files = await collectEntries(snapshot.entries);
    const target = pickSkillFile(Array.from(files.keys()));
    if (!target) {
      throw new Error(
        "That folder doesn't contain a SKILL.md. Drop the skill folder itself, or its SKILL.md."
      );
    }
    const file = await readFile(files.get(target)!);
    return {
      markdown: isZip(file.name) ? await markdownFromZip(file) : await file.text(),
      label: target,
    };
  }

  // Prefer a SKILL.md when several loose files come in at once.
  const names = snapshot.files.map((f) => f.name);
  const picked = pickSkillFile(names);
  const file =
    (picked ? snapshot.files[names.indexOf(picked)] : undefined) ??
    snapshot.files.find((f) => isZip(f.name)) ??
    snapshot.files[0];

  if (!file) {
    throw new Error("Nothing readable in that drop. Drop a SKILL.md file, .zip bundle, or folder.");
  }

  return {
    markdown: isZip(file.name) ? await markdownFromZip(file) : await file.text(),
    label: file.name,
  };
}
