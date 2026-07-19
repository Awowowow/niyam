import { basename } from "node:path";

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_POLICY_TEXT_CHARACTERS = 250_000;

function safeFilename(value: string): string {
  const filename = basename(value.trim());
  if (!filename || filename.length > 240) {
    throw new Error("Document filename must contain 1 to 240 characters");
  }
  return filename;
}

function decodeDocument(value: string): Buffer {
  if (value.length > 7_100_000 || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(value)) {
    throw new Error("Document content is not valid base64");
  }
  const content = Buffer.from(value, "base64");
  if (!content.length) throw new Error("The selected document is empty");
  if (content.length > MAX_DOCUMENT_BYTES) {
    throw new Error("Policy documents must be 5 MB or smaller");
  }
  return content;
}

export interface ExtractedDocument {
  filename: string;
  mimeType: "application/pdf" | "text/plain";
  text: string;
  pages: Array<{ page: number; text: string }>;
  extraction: "pypdf" | "utf8" | "inline-text";
}

export async function extractPolicyDocument(input: {
  filename: string;
  mimeType: "application/pdf" | "text/plain";
  contentBase64?: string;
  text?: string;
}): Promise<ExtractedDocument> {
  const filename = safeFilename(input.filename);
  if (input.text?.trim()) {
    const text = input.text.trim();
    if (text.length > MAX_POLICY_TEXT_CHARACTERS) {
      throw new Error("Policy text must be 250,000 characters or shorter");
    }
    return {
      filename,
      mimeType: input.mimeType,
      text,
      pages: [{ page: 1, text }],
      extraction: "inline-text",
    };
  }
  if (!input.contentBase64) throw new Error("Document content is required");
  const content = decodeDocument(input.contentBase64);
  if (
    input.mimeType === "application/pdf" &&
    !content.subarray(0, 5).equals(Buffer.from("%PDF-"))
  ) {
    throw new Error("The selected file is not a valid PDF document");
  }
  const baseUrl = process.env.NIYAM_SOLVER_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    if (input.mimeType === "text/plain") {
      const text = content.toString("utf8");
      if (text.includes("\0")) {
        throw new Error("The selected text file contains binary data");
      }
      return {
        filename,
        mimeType: input.mimeType,
        text,
        pages: [{ page: 1, text }],
        extraction: "utf8",
      };
    }
    throw new Error("PDF extraction requires the Niyam verification service");
  }
  const response = await fetch(`${baseUrl}/v1/documents/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      mime_type: input.mimeType,
      content_base64: input.contentBase64,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Document extractor returned ${response.status}`);
  const result = (await response.json()) as {
    filename: string;
    mime_type: "application/pdf" | "text/plain";
    text: string;
    pages: Array<{ page: number; text: string }>;
    extraction: "pypdf" | "utf8";
  };
  if (!result.text.trim()) {
    throw new Error(
      "No selectable text was found. Upload a text-based PDF or paste the policy text; scanned-image OCR is not enabled in this build.",
    );
  }
  return {
    filename,
    mimeType: result.mime_type,
    text: result.text,
    pages: result.pages,
    extraction: result.extraction,
  };
}
