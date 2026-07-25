// Parses the constrained markdown subset the motion-drafting model is
// instructed to produce (see motion-draft.server.ts's system prompt: #/##
// headings, **bold**, *** dividers, numbered Statement-of-Facts lists,
// plain paragraphs, and a signature block). Used by both the in-app
// preview (MotionPreview) and the .docx export (motionMarkdownToDocx),
// so what the attorney sees on screen matches what they get in Word.
//
// This is deliberately a small hand-written parser rather than a
// general-purpose markdown library: the model only ever emits this fixed
// vocabulary, and keeping it dependency-free avoids adding an unvetted
// package to a legal-document rendering path.
import { AlignmentType, Document, HeadingLevel, Paragraph, TabStopType, TextRun } from "docx";
import jsPDF from "jspdf";

export type MotionBlock =
  | { type: "hr" }
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "signature-line" }
  | { type: "ordered-item"; index: number; text: string }
  | { type: "paragraph"; text: string; italic?: boolean };

/** Splits inline **bold** / *italic* markup into plain runs for rendering. */
export type InlineRun = { text: string; bold?: boolean; italic?: boolean };

export function parseInline(raw: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Bold first (**...**), then italic (*...*) on what's left, so a single
  // leftover asterisk from a consumed bold pair never gets mis-parsed.
  const boldSplit = raw.split(/(\*\*[^*]+\*\*)/g);
  for (const chunk of boldSplit) {
    if (!chunk) continue;
    const boldMatch = chunk.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      runs.push({ text: boldMatch[1], bold: true });
      continue;
    }
    const italicSplit = chunk.split(/(\*[^*]+\*)/g);
    for (const sub of italicSplit) {
      if (!sub) continue;
      const italicMatch = sub.match(/^\*([^*]+)\*$/);
      if (italicMatch) runs.push({ text: italicMatch[1], italic: true });
      else runs.push({ text: sub });
    }
  }
  return runs;
}

export function parseMotionMarkdown(md: string): MotionBlock[] {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: MotionBlock[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text) blocks.push({ type: "paragraph", text });
      para = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (line === "" || line === "\u200b") {
      flushPara();
      continue;
    }
    if (/^\*{3,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ type: "hr" });
      continue;
    }
    if (/^_{3,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ type: "signature-line" });
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushPara();
      blocks.push({ type: "h3", text: line.replace(/^###\s+/, "") });
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushPara();
      blocks.push({ type: "h2", text: line.replace(/^##\s+/, "") });
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushPara();
      blocks.push({ type: "h1", text: line.replace(/^#\s+/, "") });
      continue;
    }
    const ordered = line.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      flushPara();
      blocks.push({ type: "ordered-item", index: Number(ordered[1]), text: ordered[2] });
      continue;
    }
    // A line that's *only* italic (e.g. "*Attorney Name*") in the
    // signature block gets its own paragraph so it doesn't merge with
    // surrounding body text.
    const soloItalic = line.match(/^\*([^*]+)\*$/);
    if (soloItalic) {
      flushPara();
      blocks.push({ type: "paragraph", text: soloItalic[1], italic: true });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

// ===== In-app preview ==================================================

function InlineText({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {r.text}
          </strong>
        ) : r.italic ? (
          <em key={i}>{r.text}</em>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/** Renders drafted motion markdown as a properly formatted legal document, not raw text. */
export function MotionPreview({ markdown }: { markdown: string }) {
  const blocks = parseMotionMarkdown(markdown);

  const nodes: React.ReactNode[] = [];
  let orderedBuf: { index: number; text: string }[] = [];
  const flushOrdered = (key: string) => {
    if (orderedBuf.length) {
      nodes.push(
        <ol key={key} className="my-2 list-none space-y-1.5 pl-0">
          {orderedBuf.map((it) => (
            <li key={it.index} className="flex gap-2 text-[13px] leading-relaxed text-foreground/90">
              <span className="shrink-0 tabular-nums text-foreground/60">{it.index}.</span>
              <span>
                <InlineText runs={parseInline(it.text)} />
              </span>
            </li>
          ))}
        </ol>,
      );
      orderedBuf = [];
    }
  };

  blocks.forEach((b, i) => {
    if (b.type === "ordered-item") {
      orderedBuf.push({ index: b.index, text: b.text });
      return;
    }
    flushOrdered(`ol-${i}`);
    if (b.type === "hr") {
      nodes.push(<hr key={i} className="my-3 border-border" />);
    } else if (b.type === "signature-line") {
      nodes.push(<div key={i} className="mt-4 mb-1 w-56 border-b border-foreground/50" />);
    } else if (b.type === "h1") {
      nodes.push(
        <h1 key={i} className="my-3 text-center text-[13px] font-bold uppercase tracking-wide text-foreground">
          {b.text}
        </h1>,
      );
    } else if (b.type === "h2") {
      nodes.push(
        <h2 key={i} className="mt-4 mb-1.5 text-[13px] font-bold uppercase tracking-wide text-foreground/95">
          {b.text}
        </h2>,
      );
    } else if (b.type === "h3") {
      nodes.push(
        <h3 key={i} className="mt-3 mb-1 text-[13px] font-semibold text-foreground/90">
          {b.text}
        </h3>,
      );
    } else {
      nodes.push(
        <p
          key={i}
          className={`my-1.5 text-[13px] leading-relaxed text-foreground/90 ${b.italic ? "italic text-foreground/70" : ""}`}
        >
          <InlineText runs={parseInline(b.text)} />
        </p>,
      );
    }
  });
  flushOrdered("ol-end");

  return <div className="font-serif">{nodes}</div>;
}

// ===== PDF export ========================================================
//
// Built from the exact same parseMotionMarkdown(blocks) the on-screen
// MotionPreview renders, so "Download PDF" reproduces what the attorney
// sees — not a second, independently-drifting interpretation of the
// markdown. This is the primary export format for Motion Intelligence;
// DOCX generation above is kept working but is no longer exposed in the UI.

// jsPDF's bundled fonts are WinAnsi (Latin-1) only — smart quotes, en/em
// dashes, and other punctuation an LLM draft commonly emits render as
// garbage glyphs otherwise. Normalize to plain ASCII before it ever reaches
// the PDF, the same way export.ts's case-report PDF does.
function pdfSafe(s: string): string {
  if (!s) return s;
  return s
    .replace(/–|—/g, "-")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2022/g, "*")
    .replace(/\u00b7/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

const PDF_MARGIN = 72; // 1in at 72pt/in
const PDF_PAGE_W = 612; // US Letter, pt
const PDF_PAGE_H = 792;
const PDF_CONTENT_W = PDF_PAGE_W - PDF_MARGIN * 2;
const PDF_LINE_H = 14.4; // 12pt Times, ~1.2x leading
const PDF_FOOTER_Y = PDF_PAGE_H - 40;

export function motionMarkdownToPdf(title: string, markdown: string): jsPDF {
  const blocks = parseMotionMarkdown(markdown);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = PDF_MARGIN;
  let page = 1;
  let sawFirstHr = false;
  let inCaption = false;

  const newPage = () => {
    stampFooter();
    doc.addPage();
    page += 1;
    y = PDF_MARGIN;
  };

  const stampFooter = () => {
    doc.setFont("times", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(pdfSafe(title || "Motion"), PDF_MARGIN, PDF_FOOTER_Y);
    doc.text(String(page), PDF_PAGE_W - PDF_MARGIN, PDF_FOOTER_Y, { align: "right" });
    doc.setTextColor(0);
  };

  const ensureRoom = (need: number) => {
    if (y + need > PDF_PAGE_H - PDF_MARGIN - 20) newPage();
  };

  const inlinePlain = (text: string) =>
    pdfSafe(
      parseInline(text)
        .map((r) => r.text)
        .join(""),
    );

  const writeParagraph = (
    text: string,
    opts: {
      bold?: boolean;
      italic?: boolean;
      align?: "left" | "center" | "justify";
      size?: number;
      before?: number;
    },
  ) => {
    const size = opts.size ?? 12;
    const align = opts.align ?? "justify";
    doc.setFont(
      "times",
      opts.bold && opts.italic ? "bolditalic" : opts.bold ? "bold" : opts.italic ? "italic" : "normal",
    );
    doc.setFontSize(size);
    const lineH = (size / 12) * PDF_LINE_H;
    const lines = doc.splitTextToSize(inlinePlain(text), PDF_CONTENT_W) as string[];
    if (opts.before) y += opts.before;
    ensureRoom(lines.length * lineH);
    for (const line of lines) {
      const x = align === "center" ? PDF_PAGE_W / 2 : PDF_MARGIN;
      doc.text(line, x, y, {
        align: align === "center" ? "center" : "left",
        maxWidth: PDF_CONTENT_W,
      });
      y += lineH;
    }
  };

  const writeOrderedItem = (index: number, text: string) => {
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    const label = `${index}.`;
    const indent = 24;
    const lines = doc.splitTextToSize(inlinePlain(text), PDF_CONTENT_W - indent) as string[];
    ensureRoom(lines.length * PDF_LINE_H);
    doc.text(label, PDF_MARGIN, y);
    lines.forEach((line, li) => {
      doc.text(line, PDF_MARGIN + indent, y);
      if (li < lines.length - 1) y += PDF_LINE_H;
    });
    y += PDF_LINE_H + 6;
  };

  for (const b of blocks) {
    if (b.type === "hr") {
      sawFirstHr = true;
      inCaption = !inCaption;
      ensureRoom(16);
      y += 6;
      doc.setDrawColor(180);
      doc.line(PDF_MARGIN, y, PDF_PAGE_W - PDF_MARGIN, y);
      y += 14;
      continue;
    }
    if (b.type === "signature-line") {
      ensureRoom(30);
      y += 30;
      doc.setDrawColor(0);
      doc.line(PDF_MARGIN, y, PDF_MARGIN + 220, y);
      y += 14;
      continue;
    }
    if (b.type === "h1") {
      writeParagraph(b.text.toUpperCase(), { bold: true, align: "center", before: 8 });
      y += 6;
      continue;
    }
    if (b.type === "h2") {
      writeParagraph(b.text.toUpperCase(), { bold: true, align: "left", before: 14 });
      y += 4;
      continue;
    }
    if (b.type === "h3") {
      writeParagraph(b.text, { bold: true, align: "left", before: 10 });
      y += 2;
      continue;
    }
    if (b.type === "ordered-item") {
      writeOrderedItem(b.index, b.text);
      continue;
    }
    // paragraph — caption block (between the first two dividers) and the
    // pre-caption case title are centered, matching MotionPreview's layout.
    const centered = !sawFirstHr || (inCaption && isCaptionLine(b.text));
    writeParagraph(b.text, {
      italic: b.italic,
      align: b.italic ? "left" : centered ? "center" : "justify",
      before: centered ? 2 : 6,
    });
  }
  stampFooter();
  return doc;
}

export async function downloadMotionPdf(title: string, markdown: string) {
  const doc = motionMarkdownToPdf(title, markdown);
  doc.save(`${slug(title)}.pdf`);
}

/** Opens the motion in a new tab as a PDF data URI and triggers the browser print dialog. */
export function printMotion(title: string, markdown: string) {
  const doc = motionMarkdownToPdf(title, markdown);
  const blobUrl = doc.output("bloburl") as unknown as string;
  const win = window.open(blobUrl, "_blank");
  if (!win) return;
  win.addEventListener("load", () => {
    win.focus();
    win.print();
  });
}

// ===== DOCX export ======================================================

const isCaptionLine = (t: string) =>
  /^(plaintiff|defendant|v\.|vs\.|in the |case no\.|civil action|criminal case)/i.test(t.trim()) || /,$/.test(t.trim());

export function motionMarkdownToDocx(title: string, markdown: string): Document {
  const blocks = parseMotionMarkdown(markdown);
  const children: Paragraph[] = [];
  let sawFirstHr = false;
  let inCaption = false;
  let orderedBuf: { index: number; text: string }[] = [];

  const inlineRuns = (text: string, extra: { italics?: boolean } = {}) =>
    parseInline(text).map((r) => new TextRun({ text: r.text, bold: r.bold, italics: r.italic || extra.italics }));

  const flushOrdered = () => {
    for (const it of orderedBuf) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          indent: { left: 360, hanging: 360 },
          tabStops: [{ type: TabStopType.LEFT, position: 360 }],
          children: [new TextRun({ text: `${it.index}.\t` }), ...inlineRuns(it.text)],
        }),
      );
    }
    orderedBuf = [];
  };

  for (const b of blocks) {
    if (b.type === "ordered-item") {
      orderedBuf.push({ index: b.index, text: b.text });
      continue;
    }
    flushOrdered();

    if (b.type === "hr") {
      sawFirstHr = true;
      inCaption = !inCaption; // caption block sits between the first two dividers
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      continue;
    }
    if (b.type === "signature-line") {
      children.push(
        new Paragraph({
          spacing: { before: 400, after: 40 },
          children: [new TextRun("_".repeat(40))],
        }),
      );
      continue;
    }
    if (b.type === "h1") {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 240 },
          children: [new TextRun({ text: b.text.toUpperCase(), bold: true })],
        }),
      );
      continue;
    }
    if (b.type === "h2") {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({ text: b.text.toUpperCase(), bold: true })],
        }),
      );
      continue;
    }
    if (b.type === "h3") {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: b.text, bold: true })],
        }),
      );
      continue;
    }
    // paragraph (including caption lines and the signature block)
    const centered = !sawFirstHr || (inCaption && isCaptionLine(b.text));
    children.push(
      new Paragraph({
        alignment: b.italic ? AlignmentType.LEFT : centered ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { after: centered ? 60 : 160 },
        children: inlineRuns(b.text, { italics: b.italic }),
      }),
    );
  }
  flushOrdered();

  return new Document({
    styles: {
      default: {
        document: { run: { font: "Times New Roman", size: 24 } }, // 12pt
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }, // 1in margins
        },
        children,
      },
    ],
  });
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "motion"
  );
}

