import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type ExtractedDocument = {
  text: string;
  /** Shown to the person after an import, when the result deserves a caveat. */
  note?: string;
};

const TEXT_EXTENSIONS = /\.(md|markdown|txt|text|csv|tsv|json|ya?ml|log)$/i;

/** Collapses the ragged whitespace that PDF and DOCX extraction leaves behind. */
function tidy(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Turns an uploaded document into markdown-ish text for a brain doc.
 *
 * Runs server-side against bytes already in storage rather than on an upload
 * request, so a large PDF is never bounded by the platform's request body
 * limit. The libraries are also node-only, which rules out doing this in the
 * browser.
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  filename: string,
  mimeType: string | null
): Promise<ExtractedDocument> {
  const lower = filename.toLowerCase();
  const mime = mimeType ?? "";

  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const merged = tidy(Array.isArray(text) ? text.join("\n\n") : text);

    if (!merged) {
      return {
        text: "",
        note: `No text layer found in this PDF across ${totalPages} page${
          totalPages === 1 ? "" : "s"
        } — it is probably a scan. Run it through OCR first, or paste the text in by hand.`,
      };
    }
    return {
      text: merged,
      note: `Extracted from ${totalPages} page${totalPages === 1 ? "" : "s"}. Layout, images, and tables are lost — check it reads correctly before saving.`,
    };
  }

  if (
    lower.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    // mammoth wants a Node Buffer, not a bare Uint8Array.
    const { value, messages } = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    const warnings = messages.filter((message) => message.type === "warning").length;
    return {
      text: tidy(value),
      note: warnings > 0 ? `Imported with ${warnings} formatting warning${warnings === 1 ? "" : "s"}.` : undefined,
    };
  }

  // .doc is the old binary format, which mammoth cannot read — say so plainly
  // rather than returning a page of mojibake.
  if (lower.endsWith(".doc")) {
    throw new Error(
      "Old .doc files aren't supported. Save it as .docx or PDF and try again."
    );
  }

  if (TEXT_EXTENSIONS.test(lower) || mime.startsWith("text/") || mime === "application/json") {
    const text = new TextDecoder().decode(bytes);
    if (text.includes("\u0000")) {
      throw new Error("That file isn't readable as text.");
    }
    return { text: tidy(text) };
  }

  throw new Error(
    "Unsupported file type. Import a PDF, .docx, or a text file (.md, .txt, .csv, .json)."
  );
}

/** Filename → a reasonable default document title. */
export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const spaced = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return filename;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
