/**
 * Shared file constants. Kept out of lib/actions/files.ts because a
 * "use server" module may only export async functions — a plain constant there
 * fails the build.
 */

export const BRAIN_BUCKET = "brain-files";

/** 50 MB, matching the bucket's own file_size_limit in migration 0009. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A short, human label for the file type column. */
export function fileKind(name: string, mimeType: string | null): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return name.slice(dot + 1).toUpperCase();
  if (mimeType) return mimeType.split("/").pop()?.toUpperCase() ?? "FILE";
  return "FILE";
}
