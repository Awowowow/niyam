import type { EvidenceVerification, SignedEvidence } from "./policy-ci-api";

type UnknownRecord = Record<string, unknown>;

interface ReportLine {
  text: string;
  font?: "regular" | "bold" | "mono";
  size?: number;
  color?: [number, number, number];
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 46;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, fallback = "Not recorded"): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function ascii(value: string): string {
  return value
    .replaceAll("₹", "INR ")
    .replaceAll("≤", "<=")
    .replaceAll("≥", ">=")
    .replaceAll("→", "->")
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "?");
}

function escapePdf(value: string): string {
  return ascii(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrap(value: string, maxChars: number): string[] {
  const paragraphs = value.split(/\r?\n/).map(ascii);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      if (word.length > maxChars) {
        if (current) lines.push(current);
        for (let index = 0; index < word.length; index += maxChars) {
          lines.push(word.slice(index, index + maxChars));
        }
        current = "";
      } else if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxChars) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function rgb(color: [number, number, number]): string {
  return color.map((channel) => (channel / 255).toFixed(3)).join(" ");
}

class PdfPage {
  readonly commands: string[] = [];

  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: [number, number, number],
    stroke?: [number, number, number],
  ): void {
    this.commands.push(
      `${rgb(fill)} rg${stroke ? ` ${rgb(stroke)} RG 0.8 w` : ""} ${x} ${y} ${width} ${height} re ${stroke ? "B" : "f"}`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.commands.push(
      `0.839 0.847 0.890 RG 0.7 w ${x1} ${y1} m ${x2} ${y2} l S`,
    );
  }

  text(
    value: string,
    x: number,
    y: number,
    options: ReportLine = { text: value },
  ): void {
    const font =
      options.font === "bold" ? "/F2" : options.font === "mono" ? "/F3" : "/F1";
    const size = options.size ?? 10;
    const color = options.color ?? [28, 30, 43];
    this.commands.push(
      `BT ${font} ${size} Tf ${rgb(color)} rg ${x} ${y} Td (${escapePdf(value)}) Tj ET`,
    );
  }

  wrapped(
    value: string,
    x: number,
    y: number,
    width: number,
    options: ReportLine = { text: value },
    lineHeight?: number,
  ): number {
    const size = options.size ?? 10;
    const lines = wrap(value, Math.max(10, Math.floor(width / (size * 0.53))));
    const leading = lineHeight ?? size * 1.4;
    lines.forEach((line, index) =>
      this.text(line, x, y - index * leading, options),
    );
    return y - lines.length * leading;
  }

  stream(): string {
    return this.commands.join("\n");
  }
}

function compact(value: string, head = 20, tail = 14): string {
  return value.length > head + tail + 3
    ? `${value.slice(0, head)}...${value.slice(-tail)}`
    : value;
}

function outcome(value: unknown): string {
  const candidate = record(value);
  return text(candidate.outcomeCode ?? candidate.code ?? candidate.label);
}

function createOverviewPage(
  evidence: SignedEvidence,
  verification: EvidenceVerification,
): PdfPage {
  const page = new PdfPage();
  const payload = record(evidence.signedPayload);
  const beforeAfter = record(payload.beforeAfter);
  const sourceTrace = record(payload.sourceTrace);
  const independent = record(payload.independentVerification);
  const existingTests = record(independent.existingTests);
  const policyTests = record(independent.generatedPolicyTests);
  const adversarial = record(independent.adversarialReview);
  const branches = record(adversarial.policyBranches);
  const approvals = Array.isArray(payload.approvals) ? payload.approvals : [];
  const verified = verification.valid;

  page.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, [248, 249, 252]);
  page.rect(0, 696, PAGE_WIDTH, 146, [24, 25, 37]);
  page.text("NIYAM", MARGIN, 798, {
    text: "NIYAM",
    font: "bold",
    size: 10,
    color: [139, 155, 255],
  });
  page.text("Verified repair report", MARGIN, 758, {
    text: "Verified repair report",
    font: "bold",
    size: 27,
    color: [255, 255, 255],
  });
  page.wrapped(
    "Human-readable summary of the signed policy, code repair, tests, and approvals.",
    MARGIN,
    729,
    365,
    { text: "", size: 10, color: [205, 209, 229] },
  );
  page.rect(438, 751, 111, 34, verified ? [29, 169, 121] : [202, 79, 67]);
  page.text(verified ? "VERIFIED" : "NOT VERIFIED", 459, 763, {
    text: "",
    font: "bold",
    size: 10,
    color: [255, 255, 255],
  });

  page.text("Decision corrected", MARGIN, 660, {
    text: "",
    font: "bold",
    size: 15,
  });
  page.rect(MARGIN, 582, 238, 55, [255, 239, 237], [237, 184, 177]);
  page.text("BEFORE REPAIR", MARGIN + 16, 617, {
    text: "",
    font: "bold",
    size: 8,
    color: [148, 63, 53],
  });
  page.text(outcome(beforeAfter.before), MARGIN + 16, 595, {
    text: "",
    font: "bold",
    size: 16,
    color: [148, 63, 53],
  });
  page.rect(311, 582, 238, 55, [230, 249, 240], [132, 208, 177]);
  page.text("AFTER VERIFIED REPAIR", 327, 617, {
    text: "",
    font: "bold",
    size: 8,
    color: [18, 115, 79],
  });
  page.text(outcome(beforeAfter.after), 327, 595, {
    text: "",
    font: "bold",
    size: 16,
    color: [18, 115, 79],
  });

  page.text("What Niyam verified", MARGIN, 546, {
    text: "",
    font: "bold",
    size: 15,
  });
  const rows: Array<[string, string]> = [
    [
      "Application source",
      `${text(sourceTrace.file)}:${number(sourceTrace.line) || "?"}`,
    ],
    [
      "Existing application tests",
      `${number(existingTests.passed)}/${number(existingTests.total)} passed`,
    ],
    [
      "Generated policy tests",
      `${number(policyTests.passed)}/${number(policyTests.total)} passed`,
    ],
    [
      "Independent edge-case search",
      `${number(adversarial.casesGenerated)} cases, ${number(branches.covered)}/${number(branches.total)} rule paths, ${number(adversarial.counterexamplesFound)} failures`,
    ],
    ["Human approvals", `${approvals.length}/2 recorded`],
  ];
  let y = 516;
  rows.forEach(([label, value]) => {
    page.line(MARGIN, y - 9, PAGE_WIDTH - MARGIN, y - 9);
    page.text(label, MARGIN, y, {
      text: "",
      size: 9,
      color: [92, 96, 116],
    });
    page.text(value, 247, y, { text: "", font: "bold", size: 9 });
    y -= 34;
  });

  page.rect(MARGIN, 272, PAGE_WIDTH - MARGIN * 2, 76, [238, 240, 255]);
  page.text("AUTHORITY BOUNDARY", MARGIN + 16, 327, {
    text: "",
    font: "bold",
    size: 8,
    color: [63, 78, 198],
  });
  page.wrapped(
    "AI proposed the code repair. A policy owner confirmed the rule and an engineer approved the patch. Niyam did not merge or deploy code automatically.",
    MARGIN + 16,
    307,
    PAGE_WIDTH - MARGIN * 2 - 32,
    { text: "", size: 10 },
  );

  page.text("Cryptographic integrity", MARGIN, 235, {
    text: "",
    font: "bold",
    size: 15,
  });
  page.text("Evidence hash", MARGIN, 207, {
    text: "",
    size: 8,
    color: [92, 96, 116],
  });
  page.text(compact(evidence.integrityHash, 32, 24), MARGIN, 190, {
    text: "",
    font: "mono",
    size: 8,
  });
  page.text("Signing key fingerprint", MARGIN, 162, {
    text: "",
    size: 8,
    color: [92, 96, 116],
  });
  page.text(
    compact(evidence.signature.publicKeyFingerprint, 32, 24),
    MARGIN,
    145,
    {
      text: "",
      font: "mono",
      size: 8,
    },
  );
  page.wrapped(
    "This PDF is a readable rendering. The separately downloadable signed JSON remains the machine-verifiable source record.",
    MARGIN,
    105,
    PAGE_WIDTH - MARGIN * 2,
    { text: "", size: 8, color: [92, 96, 116] },
  );
  page.text("Niyam - software should earn the right to say no", MARGIN, 38, {
    text: "",
    font: "bold",
    size: 8,
    color: [63, 78, 198],
  });
  page.text("1 / 2", PAGE_WIDTH - MARGIN - 20, 38, {
    text: "",
    size: 8,
    color: [92, 96, 116],
  });
  return page;
}

function createTechnicalPage(
  evidence: SignedEvidence,
  verification: EvidenceVerification,
): PdfPage {
  const page = new PdfPage();
  const payload = record(evidence.signedPayload);
  const sourceTrace = record(payload.sourceTrace);
  const tests = Array.isArray(payload.testsExecuted)
    ? payload.testsExecuted
    : [];
  const approvals = Array.isArray(payload.approvals) ? payload.approvals : [];

  page.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, [248, 249, 252]);
  page.text("NIYAM / TECHNICAL RECORD", MARGIN, 796, {
    text: "",
    font: "bold",
    size: 9,
    color: [63, 78, 198],
  });
  page.text("Evidence behind the repair", MARGIN, 757, {
    text: "",
    font: "bold",
    size: 24,
  });
  page.text(`Created ${text(payload.createdAt)}`, MARGIN, 735, {
    text: "",
    size: 9,
    color: [92, 96, 116],
  });

  page.text("Source trace", MARGIN, 690, { text: "", font: "bold", size: 14 });
  page.text(
    `${text(sourceTrace.file)}:${number(sourceTrace.line) || "?"}`,
    MARGIN,
    666,
    {
      text: "",
      font: "mono",
      size: 9,
    },
  );
  page.rect(MARGIN, 610, PAGE_WIDTH - MARGIN * 2, 39, [255, 239, 237]);
  page.wrapped(
    text(sourceTrace.snippet),
    MARGIN + 12,
    633,
    PAGE_WIDTH - MARGIN * 2 - 24,
    { text: "", font: "mono", size: 8, color: [126, 52, 45] },
  );

  page.text("Verified patch", MARGIN, 579, {
    text: "",
    font: "bold",
    size: 14,
  });
  page.rect(MARGIN, 416, PAGE_WIDTH - MARGIN * 2, 145, [24, 25, 37]);
  const patchLines = wrap(text(payload.patch), 88).slice(0, 14);
  patchLines.forEach((line, index) =>
    page.text(line, MARGIN + 12, 542 - index * 9, {
      text: "",
      font: "mono",
      size: 7,
      color: line.startsWith("+")
        ? [149, 240, 203]
        : line.startsWith("-")
          ? [255, 170, 163]
          : [231, 233, 244],
    }),
  );

  page.text("Verification checks", MARGIN, 382, {
    text: "",
    font: "bold",
    size: 14,
  });
  let y = 358;
  tests.slice(0, 5).forEach((candidate) => {
    const check = record(candidate);
    page.text(
      text(check.passed) === "Not recorded" && check.passed !== true
        ? "-"
        : check.passed
          ? "PASS"
          : "FAIL",
      MARGIN,
      y,
      {
        text: "",
        font: "bold",
        size: 8,
        color: check.passed ? [18, 115, 79] : [148, 63, 53],
      },
    );
    page.text(text(check.label), MARGIN + 48, y, { text: "", size: 9 });
    y -= 24;
  });

  page.text("Recorded approvals", MARGIN, 222, {
    text: "",
    font: "bold",
    size: 14,
  });
  y = 198;
  approvals.slice(0, 3).forEach((candidate) => {
    const approval = record(candidate);
    page.text(text(approval.role).replaceAll("-", " "), MARGIN, y, {
      text: "",
      font: "bold",
      size: 9,
    });
    page.text(`${text(approval.name)} - ${text(approval.approvedAt)}`, 171, y, {
      text: "",
      size: 8,
      color: [92, 96, 116],
    });
    y -= 23;
  });

  page.line(MARGIN, 130, PAGE_WIDTH - MARGIN, 130);
  page.text("Signature verification", MARGIN, 110, {
    text: "",
    font: "bold",
    size: 9,
  });
  page.text(
    `${evidence.signature.algorithm} / signature ${verification.signatureValid ? "valid" : "invalid"} / content ${verification.integrityValid ? "intact" : "changed"} / fingerprint ${verification.fingerprintValid ? "matched" : "mismatched"}`,
    MARGIN,
    91,
    { text: "", font: "mono", size: 7 },
  );
  page.text(`Commit ${text(payload.commitHash)}`, MARGIN, 72, {
    text: "",
    font: "mono",
    size: 7,
    color: [92, 96, 116],
  });
  page.text("2 / 2", PAGE_WIDTH - MARGIN - 20, 38, {
    text: "",
    size: 8,
    color: [92, 96, 116],
  });
  return page;
}

function object(id: number, body: string): string {
  return `${id} 0 obj\n${body}\nendobj\n`;
}

function streamObject(id: number, stream: string): string {
  return object(
    id,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  );
}

export function buildEvidenceReportPdf(
  evidence: SignedEvidence,
  verification: EvidenceVerification,
): Uint8Array {
  const pageOne = createOverviewPage(evidence, verification).stream();
  const pageTwo = createTechnicalPage(evidence, verification).stream();
  const objects = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, "<< /Type /Pages /Kids [5 0 R 7 0 R] /Count 2 >>"),
    object(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
    object(
      5,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 9 0 R >> >> /Contents 6 0 R >>",
    ),
    streamObject(6, pageOne),
    object(
      7,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 9 0 R >> >> /Contents 8 0 R >>",
    ),
    streamObject(8, pageTwo),
    object(9, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"),
  ];
  const header = "%PDF-1.4\n%NIYAM\n";
  let body = header;
  const offsets = [0];
  for (const entry of objects) {
    offsets.push(body.length);
    body += entry;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function evidenceReportFilename(evidence: SignedEvidence): string {
  return evidence.filename.replace(/\.json$/i, "-verified-report.pdf");
}
