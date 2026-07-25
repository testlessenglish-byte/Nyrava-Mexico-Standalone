// Client-side DOCX + PDF export for `full_report.legal_memorandum`.
// Matches the pattern already used by src/lib/export.ts: generate in the
// browser, download via a Blob. No server route, no new endpoint, no
// pipeline coupling — additive on top of the existing report exports.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow,
  WidthType, AlignmentType, HeadingLevel, BorderStyle, ShadingType,
  convertInchesToTwip,
} from "docx";
import type { LegalMemorandum } from "@/components/LegalMemorandumPanel";

type ChronEntry = string | { date?: string; event?: string; source?: string };
type DisputedEntry = string | { claim?: string; opposing_view?: string };

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const CONTENT_WIDTH_DXA = 9360; // 8.5" - 2*1" margins, in DXA (1440/inch)

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeName(name: string): string {
  return (name || "case").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

function parseChron(entry: ChronEntry): { date: string; event: string; source: string } {
  if (typeof entry === "string") {
    const m = entry.match(/^\s*([^:]{1,40}):\s*(.*)$/);
    if (m) {
      const rest = m[2];
      const src = rest.match(/(\[[^\]]+\])\s*$/);
      return {
        date: m[1].trim(),
        event: src ? rest.slice(0, src.index).trim() : rest.trim(),
        source: src ? src[1] : "",
      };
    }
    return { date: "", event: entry, source: "" };
  }
  return { date: entry.date ?? "", event: entry.event ?? "", source: entry.source ?? "" };
}

function parseDisputed(entry: DisputedEntry): { claim: string; opposing: string } {
  if (typeof entry === "string") return { claim: entry, opposing: "" };
  return { claim: entry.claim ?? "", opposing: entry.opposing_view ?? "" };
}

// ────────────────────────── DOCX ──────────────────────────

function h1(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, font: "Times New Roman", size: 26 })],
    spacing: { before: 320, after: 160 },
    border: { bottom: { color: "333333", space: 1, style: BorderStyle.SINGLE, size: 6 } },
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, italics: true, font: "Times New Roman", size: 24 })],
    spacing: { before: 220, after: 100 },
  });
}

function p(text: string, opts: { bold?: boolean; italics?: boolean; color?: string; indent?: number } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, color: opts.color, font: "Times New Roman", size: 22 })],
    spacing: { after: 100 },
    ...(opts.indent ? { indent: { left: opts.indent } } : {}),
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `• ${text}`, font: "Times New Roman", size: 22 })],
    spacing: { after: 80 },
    indent: { left: 360 },
  });
}

function labelledPair(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, font: "Times New Roman", size: 22 }),
      new TextRun({ text: value, font: "Times New Roman", size: 22 }),
    ],
    spacing: { after: 100 },
  });
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "F1F5F9", type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, font: "Times New Roman", size: 20 })] })],
  });
}

function bodyCell(text: string, width: number, opts: { mono?: boolean; italics?: boolean; bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: opts.align,
        children: [new TextRun({
          text,
          font: opts.mono ? "Courier New" : "Times New Roman",
          size: opts.mono ? 18 : 20,
          italics: opts.italics,
          bold: opts.bold,
          color: opts.mono ? "2563EB" : undefined,
        })],
      }),
    ],
  });
}

function makeTable(headers: string[], widths: number[], rowsBody: TableCell[][]): Table {
  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => headerCell(h, widths[i])) }),
      ...rowsBody.map((cells) => new TableRow({ children: cells })),
    ],
  });
}

function buildDocxChildren(memo: LegalMemorandum, caseName: string): (Paragraph | Table)[] {
  const cap = memo.caption ?? {};
  const exec = memo.executive_summary ?? {};
  const facts = memo.statement_of_facts ?? {};
  const irac = Array.isArray(memo.legal_analysis) ? memo.legal_analysis : [];
  const motions = Array.isArray(memo.recommended_motions) ? memo.recommended_motions : [];
  const exhibits = Array.isArray(memo.evidence_appendix) ? memo.evidence_appendix : [];
  const risks = Array.isArray(memo.risk_matrix) ? memo.risk_matrix : [];
  const actions = Array.isArray(memo.next_actions) ? [...memo.next_actions] : [];

  actions.sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.priority ?? "medium").toLowerCase()] ?? 2;
    const pb = PRIORITY_ORDER[(b.priority ?? "medium").toLowerCase()] ?? 2;
    return pa - pb;
  });

  const out: (Paragraph | Table)[] = [];

  // Caption
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [new TextRun({ text: cap.title || "MEMORANDUM OF LAW", bold: true, font: "Times New Roman", size: 32 })],
    border: { bottom: { color: "1A1A1A", space: 1, style: BorderStyle.SINGLE, size: 12 } },
  }));
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: "Re: ", bold: true, font: "Times New Roman", size: 22 }),
      new TextRun({ text: cap.re || caseName, font: "Times New Roman", size: 22 }),
    ],
  }));
  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 320 },
    children: [
      new TextRun({ text: "Date: ", bold: true, font: "Times New Roman", size: 22 }),
      new TextRun({ text: cap.date || new Date().toLocaleDateString(), font: "Times New Roman", size: 22 }),
    ],
  }));

  // Executive Summary
  if (exec.dispositive_recommendation || exec.case_strength || exec.primary_risk || (exec.urgent_actions?.length ?? 0) > 0) {
    out.push(h1("EXECUTIVE SUMMARY"));
    if (exec.dispositive_recommendation) out.push(labelledPair("Bottom Line", exec.dispositive_recommendation));
    if (exec.case_strength) out.push(labelledPair("Case Strength", exec.case_strength));
    if (exec.primary_risk) out.push(labelledPair("Primary Risk", exec.primary_risk));
    if ((exec.urgent_actions?.length ?? 0) > 0) {
      out.push(p("Urgent Actions Required:", { bold: true }));
      exec.urgent_actions!.forEach((a) => out.push(bullet(a)));
    }
  }

  // Statement of Facts
  const totalFacts = (facts.chronology?.length ?? 0) + (facts.undisputed?.length ?? 0) + (facts.disputed?.length ?? 0);
  if (totalFacts > 0) {
    out.push(h1("STATEMENT OF FACTS"));

    if ((facts.chronology?.length ?? 0) > 0) {
      out.push(h2("I. Chronology"));
      const widths = [1680, 5520, 2160];
      const rows = facts.chronology!.map((raw) => {
        const c = parseChron(raw);
        return [
          bodyCell(c.date || "—", widths[0]),
          bodyCell(c.event, widths[1]),
          bodyCell(c.source, widths[2], { mono: true }),
        ];
      });
      out.push(makeTable(["Date", "Event", "Source"], widths, rows));
    }

    if ((facts.undisputed?.length ?? 0) > 0) {
      out.push(h2("II. Undisputed Facts"));
      facts.undisputed!.forEach((f) => out.push(bullet(f)));
    }

    if ((facts.disputed?.length ?? 0) > 0) {
      out.push(h2("III. Disputed Facts"));
      facts.disputed!.forEach((raw) => {
        const d = parseDisputed(raw);
        out.push(bullet(d.claim));
        if (d.opposing) out.push(p(`Opposing view: ${d.opposing}`, { italics: true, color: "666666", indent: 720 }));
      });
    }
  }

  // Legal Analysis (IRAC)
  if (irac.length > 0) {
    out.push(h1("LEGAL ANALYSIS"));
    irac.forEach((issue, i) => {
      out.push(h2(`${i + 1}. ${issue.issue || "Untitled Issue"}`));
      if (issue.rule)        { out.push(p("RULE", { bold: true })); out.push(p(issue.rule, { indent: 360 })); }
      if (issue.application) { out.push(p("APPLICATION", { bold: true })); out.push(p(issue.application, { indent: 360 })); }
      if (issue.conclusion)  { out.push(p("CONCLUSION", { bold: true })); out.push(p(issue.conclusion, { indent: 360, bold: true })); }
      if ((issue.cited_evidence?.length ?? 0) > 0) {
        out.push(p("Supporting Evidence:", { bold: true }));
        issue.cited_evidence!.forEach((ce) => {
          out.push(new Paragraph({
            spacing: { after: 60 },
            indent: { left: 360 },
            children: [
              new TextRun({ text: "▸ ", color: "2563EB", font: "Times New Roman", size: 22 }),
              new TextRun({ text: ce, font: "Courier New", size: 18, color: "2563EB" }),
            ],
          }));
        });
      }
    });
  }

  // Recommended Motions
  if (motions.length > 0) {
    out.push(h1("RECOMMENDED MOTIONS"));
    motions.forEach((m) => {
      out.push(h2(m.motion || "Untitled Motion"));
      if (m.legal_standard) out.push(labelledPair("Legal Standard", m.legal_standard));
      if ((m.factual_basis?.length ?? 0) > 0) {
        out.push(p("Factual Basis:", { bold: true }));
        m.factual_basis!.forEach((f) => out.push(bullet(f)));
      }
      if (m.likelihood) out.push(labelledPair("Likelihood of Success", m.likelihood));
      if (m.draft_paragraph) {
        out.push(p("Draft Paragraph:", { bold: true }));
        out.push(new Paragraph({
          spacing: { before: 60, after: 200 },
          indent: { left: 360, right: 360 },
          border: {
            top:    { color: "CBD5E1", space: 6, style: BorderStyle.SINGLE, size: 4 },
            bottom: { color: "CBD5E1", space: 6, style: BorderStyle.SINGLE, size: 4 },
            left:   { color: "CBD5E1", space: 6, style: BorderStyle.SINGLE, size: 4 },
            right:  { color: "CBD5E1", space: 6, style: BorderStyle.SINGLE, size: 4 },
          },
          children: [new TextRun({ text: m.draft_paragraph, italics: true, font: "Times New Roman", size: 22 })],
        }));
      }
    });
  }

  // Evidence Appendix
  if (exhibits.length > 0) {
    out.push(h1("EVIDENCE APPENDIX"));
    const widths = [720, 2160, 720, 2400, 2160, 1200];
    const rows = exhibits.map((e) => [
      bodyCell(e.exhibit || "—", widths[0], { bold: true, align: AlignmentType.CENTER }),
      bodyCell(e.description || "—", widths[1]),
      bodyCell(e.page || "—", widths[2], { mono: true, align: AlignmentType.CENTER }),
      bodyCell(
        e.key_quote ? `"${e.key_quote.slice(0, 200)}${e.key_quote.length > 200 ? "…" : ""}"` : "—",
        widths[3],
        { italics: true },
      ),
      bodyCell(e.proves || "—", widths[4]),
      bodyCell(e.admissibility_risk || "—", widths[5], { align: AlignmentType.CENTER }),
    ]);
    out.push(makeTable(["Exhibit", "Description", "Page", "Key Quote", "Proves", "Risk"], widths, rows));
  }

  // Risk Matrix
  if (risks.length > 0) {
    out.push(h1("RISK MATRIX"));
    const widths = [3600, 1440, 1440, 2880];
    const rows = risks.map((r) => [
      bodyCell(r.risk || "—", widths[0]),
      bodyCell(r.probability || "—", widths[1], { align: AlignmentType.CENTER }),
      bodyCell(r.impact || "—", widths[2], { align: AlignmentType.CENTER }),
      bodyCell(r.mitigation || "—", widths[3]),
    ]);
    out.push(makeTable(["Risk", "Probability", "Impact", "Mitigation"], widths, rows));
  }

  // Next Actions
  if (actions.length > 0) {
    out.push(h1("NEXT ACTIONS"));
    const widths = [1200, 4800, 1680, 1680];
    const rows = actions.map((a) => [
      bodyCell(a.priority || "—", widths[0], { bold: true, align: AlignmentType.CENTER }),
      bodyCell(a.action || "—", widths[1]),
      bodyCell(a.owner || "—", widths[2]),
      bodyCell(a.deadline || "—", widths[3]),
    ]);
    out.push(makeTable(["Priority", "Action", "Owner", "Deadline"], widths, rows));
  }

  out.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
    children: [new TextRun({
      text: "Attorney-reviewed work product. Nyrava Intelligence-generated draft — verify all citations before filing.",
      italics: true, color: "64748B", font: "Times New Roman", size: 18,
    })],
  }));

  return out;
}

export async function downloadLegalMemoDocx(memo: LegalMemorandum, caseName: string): Promise<void> {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children: buildDocxChildren(memo, caseName),
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveBlob(blob, `${safeName(caseName)}-Legal-Memo.docx`);
}

// ────────────────────────── PDF ──────────────────────────

// jsPDF Helvetica is Latin-1; strip anything outside that range so we don't
// print corrupted glyphs (same technique as export.ts).
function pdfSafe(s: string): string {
  if (!s) return s;
  return s
    .replace(/–|—/g, "-")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/▸/g, ">")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "");
}

export function downloadLegalMemoPdf(memo: LegalMemorandum, caseName: string): void {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 1;
  const pageW = 8.5;
  const pageH = 11;
  const textW = pageW - margin * 2;
  let y = margin;

  const ensureRoom = (need = 0.4) => {
    if (y + need > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const center = (text: string, size = 12, bold = false) => {
    ensureRoom(size / 72 + 0.15);
    doc.setFontSize(size);
    doc.setFont("times", bold ? "bold" : "normal");
    const t = pdfSafe(text);
    const w = doc.getTextWidth(t);
    doc.text(t, pageW / 2 - w / 2, y);
    y += size / 72 + 0.12;
  };

  const left = (text: string, size = 12, bold = false, indent = 0) => {
    ensureRoom(size / 72 + 0.1);
    doc.setFontSize(size);
    doc.setFont("times", bold ? "bold" : "normal");
    doc.text(pdfSafe(text), margin + indent, y);
    y += size / 72 + 0.1;
  };

  const wrap = (text: string, size = 11, indent = 0, opts: { italic?: boolean; color?: [number, number, number]; mono?: boolean } = {}) => {
    doc.setFontSize(size);
    doc.setFont(opts.mono ? "courier" : "times", opts.italic ? "italic" : "normal");
    if (opts.color) doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]); else doc.setTextColor(0, 0, 0);
    const lines = doc.splitTextToSize(pdfSafe(text), textW - indent) as string[];
    for (const line of lines) {
      ensureRoom(size / 72 + 0.05);
      doc.text(line, margin + indent, y);
      y += size / 72 + 0.05;
    }
    doc.setTextColor(0, 0, 0);
  };

  const sectionHeading = (text: string) => {
    ensureRoom(0.6);
    y += 0.15;
    doc.setFontSize(13);
    doc.setFont("times", "bold");
    doc.text(pdfSafe(text), margin, y);
    doc.setLineWidth(0.02);
    doc.line(margin, y + 0.06, pageW - margin, y + 0.06);
    y += 0.25;
  };

  const runTable = (head: string[], body: string[][], columnStyles?: Record<number, { cellWidth?: number }>) => {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [head],
      body,
      styles: { font: "times", fontSize: 9, cellPadding: 0.05, overflow: "linebreak" },
      headStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
      theme: "grid",
      columnStyles,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 0.15;
  };

  // Caption
  center(memo.caption?.title || "MEMORANDUM OF LAW", 16, true);
  doc.setLineWidth(0.02);
  doc.line(margin, y, pageW - margin, y);
  y += 0.15;
  center(`Re: ${memo.caption?.re || caseName}`, 11);
  center(`Date: ${memo.caption?.date || new Date().toLocaleDateString()}`, 11);
  y += 0.15;

  const exec = memo.executive_summary ?? {};
  if (exec.dispositive_recommendation || exec.case_strength || exec.primary_risk || (exec.urgent_actions?.length ?? 0) > 0) {
    sectionHeading("EXECUTIVE SUMMARY");
    if (exec.dispositive_recommendation) {
      left("Bottom Line:", 11, true);
      wrap(exec.dispositive_recommendation, 11, 0.2);
    }
    if (exec.case_strength) wrap(`Case Strength: ${exec.case_strength}`, 11);
    if (exec.primary_risk) wrap(`Primary Risk: ${exec.primary_risk}`, 11);
    if ((exec.urgent_actions?.length ?? 0) > 0) {
      left("Urgent Actions Required:", 11, true);
      exec.urgent_actions!.forEach((a) => wrap(`* ${a}`, 11, 0.2));
    }
  }

  const facts = memo.statement_of_facts ?? {};
  if ((facts.chronology?.length ?? 0) + (facts.undisputed?.length ?? 0) + (facts.disputed?.length ?? 0) > 0) {
    sectionHeading("STATEMENT OF FACTS");
    if ((facts.chronology?.length ?? 0) > 0) {
      left("I. Chronology", 11, true);
      const rows = facts.chronology!.map((raw) => {
        const c = parseChron(raw);
        return [pdfSafe(c.date), pdfSafe(c.event), pdfSafe(c.source)];
      });
      runTable(["Date", "Event", "Source"], rows, { 0: { cellWidth: 1.1 }, 2: { cellWidth: 1.4 } });
    }
    if ((facts.undisputed?.length ?? 0) > 0) {
      left("II. Undisputed Facts", 11, true);
      facts.undisputed!.forEach((f) => wrap(`* ${f}`, 11, 0.2));
      y += 0.05;
    }
    if ((facts.disputed?.length ?? 0) > 0) {
      left("III. Disputed Facts", 11, true);
      facts.disputed!.forEach((raw) => {
        const d = parseDisputed(raw);
        wrap(`* ${d.claim}`, 11, 0.2);
        if (d.opposing) wrap(`(Opposing view: ${d.opposing})`, 10, 0.4, { italic: true, color: [102, 102, 102] });
      });
    }
  }

  const irac = memo.legal_analysis ?? [];
  if (irac.length > 0) {
    sectionHeading("LEGAL ANALYSIS");
    irac.forEach((issue, i) => {
      ensureRoom(0.8);
      left(`${i + 1}. ${issue.issue || ""}`, 11, true);
      if (issue.rule)        { left("RULE:", 10, true, 0.2); wrap(issue.rule, 11, 0.4); }
      if (issue.application) { left("APPLICATION:", 10, true, 0.2); wrap(issue.application, 11, 0.4); }
      if (issue.conclusion)  { left("CONCLUSION:", 10, true, 0.2); wrap(issue.conclusion, 11, 0.4); }
      (issue.cited_evidence ?? []).forEach((ce) => {
        wrap(`> ${ce}`, 9, 0.4, { mono: true, color: [37, 99, 235] });
      });
      y += 0.1;
    });
  }

  const motions = memo.recommended_motions ?? [];
  if (motions.length > 0) {
    sectionHeading("RECOMMENDED MOTIONS");
    motions.forEach((m) => {
      ensureRoom(0.8);
      left(m.motion || "", 11, true);
      if (m.legal_standard) wrap(`Legal Standard: ${m.legal_standard}`, 11, 0.2);
      if ((m.factual_basis?.length ?? 0) > 0) {
        left("Factual Basis:", 10, true, 0.2);
        m.factual_basis!.forEach((f) => wrap(`* ${f}`, 11, 0.4));
      }
      if (m.likelihood) wrap(`Likelihood: ${m.likelihood}`, 11, 0.2);
      if (m.draft_paragraph) {
        left("Draft Paragraph:", 10, true, 0.2);
        wrap(`"${m.draft_paragraph}"`, 11, 0.4, { italic: true });
      }
      y += 0.1;
    });
  }

  const exhibits = memo.evidence_appendix ?? [];
  if (exhibits.length > 0) {
    sectionHeading("EVIDENCE APPENDIX");
    const rows = exhibits.map((e) => [
      pdfSafe(e.exhibit ?? ""),
      pdfSafe(e.description ?? ""),
      pdfSafe(e.page ?? ""),
      pdfSafe(e.key_quote ? `"${e.key_quote.slice(0, 160)}${e.key_quote.length > 160 ? "..." : ""}"` : ""),
      pdfSafe(e.proves ?? ""),
      pdfSafe(e.admissibility_risk ?? ""),
    ]);
    runTable(
      ["Exhibit", "Description", "Page", "Key Quote", "Proves", "Risk"],
      rows,
      { 0: { cellWidth: 0.6 }, 2: { cellWidth: 0.5 }, 3: { cellWidth: 1.9 }, 5: { cellWidth: 0.7 } },
    );
  }

  const risks = memo.risk_matrix ?? [];
  if (risks.length > 0) {
    sectionHeading("RISK MATRIX");
    const rows = risks.map((r) => [pdfSafe(r.risk ?? ""), pdfSafe(r.probability ?? ""), pdfSafe(r.impact ?? ""), pdfSafe(r.mitigation ?? "")]);
    runTable(["Risk", "Probability", "Impact", "Mitigation"], rows, { 1: { cellWidth: 0.9 }, 2: { cellWidth: 0.9 } });
  }

  const actions = memo.next_actions ? [...memo.next_actions] : [];
  if (actions.length > 0) {
    actions.sort((a, b) => {
      const pa = PRIORITY_ORDER[(a.priority ?? "medium").toLowerCase()] ?? 2;
      const pb = PRIORITY_ORDER[(b.priority ?? "medium").toLowerCase()] ?? 2;
      return pa - pb;
    });
    sectionHeading("NEXT ACTIONS");
    const rows = actions.map((a) => [pdfSafe(a.priority ?? ""), pdfSafe(a.action ?? ""), pdfSafe(a.owner ?? ""), pdfSafe(a.deadline ?? "")]);
    runTable(["Priority", "Action", "Owner", "Deadline"], rows, { 0: { cellWidth: 0.8 } });
  }

  doc.save(`${safeName(caseName)}-Legal-Memo.pdf`);
}
