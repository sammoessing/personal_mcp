import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * mammoth ships markdown conversion and image alt text at runtime, but its
 * bundled type definitions cover only the HTML path. These describe the parts
 * actually used rather than casting to any at each call site.
 */
type MammothImage = {
  read: () => Promise<Buffer>;
  contentType?: string;
  altText?: string;
};

type MammothMarkdown = {
  convertToMarkdown: (
    input: { buffer: Buffer },
    options?: { convertImage?: unknown }
  ) => Promise<{ value: string; messages: Array<{ type: string }> }>;
};

const markdownMammoth = mammoth as unknown as MammothMarkdown;

export type ExtractedDocument = {
  text: string;
  /** Shown to the person after an import, when the result deserves a caveat. */
  note?: string;
  /** How many embedded images were pulled out and kept. */
  imageCount?: number;
};

/**
 * Stores one image lifted out of a document and returns the URL the markdown
 * should point at. Supplied by the caller because extraction has no business
 * knowing about storage.
 */
export type SaveImage = (
  bytes: Uint8Array,
  contentType: string
) => Promise<string>;

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
  mimeType: string | null,
  saveImage?: SaveImage
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
      note: `Extracted text from ${totalPages} page${totalPages === 1 ? "" : "s"}. Images and layout are not carried over from PDFs — the original stays attached to this document, so nothing is lost.`,
    };
  }

  if (
    lower.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    // mammoth wants a Node Buffer, not a bare Uint8Array.
    const buffer = Buffer.from(bytes);

    // Without an image handler mammoth inlines every picture as a base64 data
    // URI, which would bloat the document and cost an agent thousands of
    // tokens for a logo. Each image is stored instead and referenced by URL.
    let imageCount = 0;
    const convertImage = saveImage
      ? mammoth.images.imgElement(async (raw: unknown) => {
          const image = raw as MammothImage;
          const imageBuffer = await image.read();
          const src = await saveImage(
            new Uint8Array(imageBuffer),
            image.contentType || "application/octet-stream"
          );
          imageCount += 1;
          return { src, alt: image.altText ?? "" };
        })
      : undefined;

    const { value, messages } = await markdownMammoth.convertToMarkdown(
      { buffer },
      convertImage ? { convertImage } : {}
    );
    const warnings = messages.filter((message) => message.type === "warning").length;

    const notes: string[] = [];
    if (imageCount > 0) {
      notes.push(`Kept ${imageCount} image${imageCount === 1 ? "" : "s"}.`);
    }
    if (warnings > 0) {
      notes.push(`${warnings} formatting warning${warnings === 1 ? "" : "s"}.`);
    }

    return {
      text: tidy(value),
      imageCount,
      note: notes.length > 0 ? notes.join(" ") : undefined,
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
