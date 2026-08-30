import { capturePdfText } from "./reporting/rendered-output";
import { releaseFinalReportPayload, releaseRenderedReportOutput, type FinalReportPayload } from "./reporting/final-report-contract";
// Client-side PDF export for `full_report.legal_memorandum`.
// Matches the pattern already used by src/lib/export.ts: generate in the
// browser, download via a Blob. No server route, no new endpoint, no
// pipeline coupling — additive on top of the existing report exports.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { LegalMemorandum } from "@/components/LegalMemorandumPanel";
import { rt } from "./report-i18n";

type ChronEntry = string | { date?: string; event?: string; source?: string };
type DisputedEntry = string | { claim?: string; opposing_view?: string };

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

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

export function downloadLegalMemoPdf(payload: FinalReportPayload, caseName: string): void {
  const validated = releaseFinalReportPayload(payload);
  const memo = (validated.report?.full_report as {legal_memorandum?:LegalMemorandum})?.legal_memorandum;
  if (!memo) throw new Error("REPORT_MEMO_UNAVAILABLE");

  const doc = new jsPDF({ unit: "in", format: "letter" });
  const renderedText = capturePdfText(doc as any);
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
  for (const section of validated.report_presentation.decision_sections) {
    sectionHeading(section.title);
    wrap(section.text);
    wrap(section.speaker_label + " · " + section.speaker_role);
  }
  center(memo.caption?.title || rt("MEMORANDUM OF LAW"), 16, true);
  doc.setLineWidth(0.02);
  doc.line(margin, y, pageW - margin, y);
  y += 0.15;
  center(`Re: ${memo.caption?.re || caseName}`, 11);
  center(`Date: ${memo.caption?.date || new Date().toLocaleDateString()}`, 11);
  y += 0.15;

  const exec = memo.executive_summary ?? {};
  if (exec.dispositive_recommendation || exec.case_strength || exec.primary_risk || (exec.urgent_actions?.length ?? 0) > 0) {
    sectionHeading(rt("EXECUTIVE SUMMARY"));
    if (exec.dispositive_recommendation) {
      left("Bottom Line:", 11, true);
      wrap(exec.dispositive_recommendation, 11, 0.2);
    }
    if (exec.case_strength) wrap(`Case Strength: ${exec.case_strength}`, 11);
    if (exec.primary_risk) wrap(`Primary Risk: ${exec.primary_risk}`, 11);
    if ((exec.urgent_actions?.length ?? 0) > 0) {
      left(rt("Urgent Actions Required:"), 11, true);
      exec.urgent_actions!.forEach((a) => wrap(`* ${a}`, 11, 0.2));
    }
  }

  const facts = memo.statement_of_facts ?? {};
  if ((facts.chronology?.length ?? 0) + (facts.undisputed?.length ?? 0) + (facts.disputed?.length ?? 0) > 0) {
    sectionHeading(rt("STATEMENT OF FACTS"));
    if ((facts.chronology?.length ?? 0) > 0) {
      left(rt("I. Chronology"), 11, true);
      const rows = facts.chronology!.map((raw) => {
        const c = parseChron(raw);
        return [pdfSafe(c.date), pdfSafe(c.event), pdfSafe(c.source)];
      });
      runTable([rt("Date"), rt("Event"), rt("Source")], rows, { 0: { cellWidth: 1.1 }, 2: { cellWidth: 1.4 } });
    }
    if ((facts.undisputed?.length ?? 0) > 0) {
      left(rt("II. Undisputed Facts"), 11, true);
      facts.undisputed!.forEach((f) => wrap(`* ${f}`, 11, 0.2));
      y += 0.05;
    }
    if ((facts.disputed?.length ?? 0) > 0) {
      left(rt("III. Disputed Facts"), 11, true);
      facts.disputed!.forEach((raw) => {
        const d = parseDisputed(raw);
        wrap(`* ${d.claim}`, 11, 0.2);
        if (d.opposing) wrap(`(${rt("Opposing view:")} ${d.opposing})`, 10, 0.4, { italic: true, color: [102, 102, 102] });
      });
    }
  }

  const irac = memo.legal_analysis ?? [];
  if (irac.length > 0) {
    sectionHeading(rt("LEGAL ANALYSIS"));
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
    sectionHeading(rt("RECOMMENDED MOTIONS"));
    motions.forEach((m) => {
      ensureRoom(0.8);
      left(m.motion || "", 11, true);
      if (m.legal_standard) wrap(`Legal Standard: ${m.legal_standard}`, 11, 0.2);
      if ((m.factual_basis?.length ?? 0) > 0) {
        left(rt("Factual Basis:"), 10, true, 0.2);
        m.factual_basis!.forEach((f) => wrap(`* ${f}`, 11, 0.4));
      }
      if (m.likelihood) wrap(`Likelihood: ${m.likelihood}`, 11, 0.2);
      if (m.draft_paragraph) {
        left(rt("Draft Paragraph:"), 10, true, 0.2);
        wrap(`"${m.draft_paragraph}"`, 11, 0.4, { italic: true });
      }
      y += 0.1;
    });
  }

  const exhibits = memo.evidence_appendix ?? [];
  if (exhibits.length > 0) {
    sectionHeading(rt("EVIDENCE APPENDIX"));
    const rows = exhibits.map((e) => [
      pdfSafe(e.exhibit ?? ""),
      pdfSafe(e.description ?? ""),
      pdfSafe(e.page ?? ""),
      pdfSafe(e.key_quote ? `"${e.key_quote.slice(0, 160)}${e.key_quote.length > 160 ? "..." : ""}"` : ""),
      pdfSafe(e.proves ?? ""),
      pdfSafe(e.admissibility_risk ?? ""),
    ]);
    runTable(
      [rt("Exhibit"), rt("Description"), rt("Page"), rt("Key Quote"), rt("Proves"), rt("Risk")],
      rows,
      { 0: { cellWidth: 0.6 }, 2: { cellWidth: 0.5 }, 3: { cellWidth: 1.9 }, 5: { cellWidth: 0.7 } },
    );
  }

  const risks = memo.risk_matrix ?? [];
  if (risks.length > 0) {
    sectionHeading(rt("RISK MATRIX"));
    const rows = risks.map((r) => [pdfSafe(r.risk ?? ""), pdfSafe(r.probability ?? ""), pdfSafe(r.impact ?? ""), pdfSafe(r.mitigation ?? "")]);
    runTable([rt("Risk"), rt("Probability"), rt("Impact"), rt("Mitigation")], rows, { 1: { cellWidth: 0.9 }, 2: { cellWidth: 0.9 } });
  }

  const actions = memo.next_actions ? [...memo.next_actions] : [];
  if (actions.length > 0) {
    actions.sort((a, b) => {
      const pa = PRIORITY_ORDER[(a.priority ?? "medium").toLowerCase()] ?? 2;
      const pb = PRIORITY_ORDER[(b.priority ?? "medium").toLowerCase()] ?? 2;
      return pa - pb;
    });
    sectionHeading(rt("NEXT ACTIONS"));
    const rows = actions.map((a) => [pdfSafe(a.priority ?? ""), pdfSafe(a.action ?? ""), pdfSafe(a.owner ?? ""), pdfSafe(a.deadline ?? "")]);
    runTable([rt("Priority"), rt("Action"), rt("Owner"), rt("Deadline")], rows, { 0: { cellWidth: 0.8 } });
  }

  releaseRenderedReportOutput(validated, "memo-pdf", renderedText.join("\n"));
  doc.save(`${safeName(caseName)}${rt("-Legal-Memo")}.pdf`);
}
