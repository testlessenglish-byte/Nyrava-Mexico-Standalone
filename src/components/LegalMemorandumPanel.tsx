import { releaseFinalReportPayload, type FinalReportPayload } from "@/lib/reporting/final-report-contract";
import { toast } from "sonner";
// NOTE: `@/lib/export-legal-memo` statically imports jsPDF (which
// transitively bundles html2canvas, a browser-only module). This component
// is rendered from `reports.tsx`, an SSR route, so a static import here
// would pull jsPDF into the server bundle and crash the SSR build.
// `downloadLegalMemoPdf` are loaded dynamically
// inside each button's onClick below instead.
// Renders `report.full_report.legal_memorandum` as a court-ready
// memorandum: Times New Roman, letter-sized page, IRAC blocks, hierarchical
// section numbering, monospace pinpoint citations. Purely presentational —
// styles live in src/styles.css under `.legal-memorandum`.

type Caption = { title?: string; date?: string; re?: string };
type Exec = {
  dispositive_recommendation?: string;
  case_strength?: string;
  primary_risk?: string;
  urgent_actions?: string[];
};
type ChronEntry = string | { date?: string; event?: string; source?: string };
type DisputedEntry = string | { claim?: string; opposing_view?: string };
type Facts = {
  undisputed?: string[];
  disputed?: DisputedEntry[];
  chronology?: ChronEntry[];
};
type IRAC = { issue?: string; rule?: string; application?: string; conclusion?: string; cited_evidence?: string[] };
type Motion = {
  motion?: string;
  legal_standard?: string;
  factual_basis?: string[];
  likelihood?: string;
  draft_paragraph?: string;
};
type Exhibit = {
  exhibit?: string;
  description?: string;
  page?: string;
  key_quote?: string;
  proves?: string;
  admissibility_risk?: string;
};
type Risk = { risk?: string; probability?: string; impact?: string; mitigation?: string };
type Action = { action?: string; owner?: string; deadline?: string; priority?: string };

export type LegalMemorandum = {
  caption?: Caption;
  executive_summary?: Exec;
  statement_of_facts?: Facts;
  legal_analysis?: IRAC[];
  recommended_motions?: Motion[];
  evidence_appendix?: Exhibit[];
  risk_matrix?: Risk[];
  next_actions?: Action[];
};

const strengthClass: Record<string, string> = {
  excellent: "strength-excellent",
  strong: "strength-strong",
  moderate: "strength-moderate",
  weak: "strength-weak",
};

function tokenClass(prefix: string, value: string | undefined): string {
  if (!value) return "";
  return `${prefix}-${value.toLowerCase().replace(/\s+/g, "-")}`;
}

// Chronology entries can arrive as a plain string ("2024-05-01: Notice sent [DOC 3 p.1]")
// or as an object. Split the string form on the first colon so the table still
// shows a date column.
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

function parseDisputed(entry: DisputedEntry): { claim: string; opposing?: string } {
  if (typeof entry === "string") return { claim: entry };
  return { claim: entry.claim ?? "", opposing: entry.opposing_view };
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function LegalMemorandumPanel({
  payload,
  memo,
  caseName,
}: {
  payload?: FinalReportPayload;
  memo: LegalMemorandum | null | undefined;
  caseName?: string;
}) {
  if (!payload) return null;
  const validated = releaseFinalReportPayload(payload);
  memo = (validated.report?.full_report as {legal_memorandum?:LegalMemorandum})?.legal_memorandum;
  if (!memo || typeof memo !== "object") return null;

  const cap = memo.caption ?? {};
  const exec = memo.executive_summary ?? {};
  const facts = memo.statement_of_facts ?? {};
  const irac = Array.isArray(memo.legal_analysis) ? memo.legal_analysis : [];
  const motions = Array.isArray(memo.recommended_motions) ? memo.recommended_motions : [];
  const exhibits = Array.isArray(memo.evidence_appendix) ? memo.evidence_appendix : [];
  const risks = Array.isArray(memo.risk_matrix) ? memo.risk_matrix : [];
  const actions = Array.isArray(memo.next_actions) ? [...memo.next_actions] : [];

  const anyContent =
    !!exec.dispositive_recommendation ||
    irac.length +
      motions.length +
      exhibits.length +
      risks.length +
      actions.length +
      (facts.undisputed?.length ?? 0) +
      (facts.disputed?.length ?? 0) +
      (facts.chronology?.length ?? 0) >
      0;
  if (!anyContent) return null;

  actions.sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.priority ?? "medium").toLowerCase()] ?? 2;
    const pb = PRIORITY_ORDER[(b.priority ?? "medium").toLowerCase()] ?? 2;
    return pa - pb;
  });

  return (
    <article className="legal-memorandum">
      {/* === CAPTION === */}
      <header className="memo-caption">
        <h1>{cap.title || "MEMORANDUM OF LAW"}</h1>
        <div className="memo-meta">
          <span>Re: {cap.re || "—"}</span>
          <span>Date: {cap.date || new Date().toLocaleDateString()}</span>
        </div>
      </header>

      {/* === EXECUTIVE SUMMARY === */}
      {(exec.dispositive_recommendation ||
        exec.case_strength ||
        exec.primary_risk ||
        (exec.urgent_actions?.length ?? 0) > 0) && (
        <section className="memo-section">
          <h2>Executive Summary</h2>
          {exec.dispositive_recommendation && (
            <div className="dispositive-box">
              <strong>Bottom Line: </strong>
              {exec.dispositive_recommendation}
            </div>
          )}
          <div className="summary-grid">
            {exec.case_strength && (
              <p>
                <strong>Case Strength: </strong>
                <span className={strengthClass[exec.case_strength.toLowerCase()] ?? ""}>{exec.case_strength}</span>
              </p>
            )}
            {exec.primary_risk && (
              <p>
                <strong>Primary Risk: </strong>
                {exec.primary_risk}
              </p>
            )}
          </div>
          {(exec.urgent_actions?.length ?? 0) > 0 && (
            <div className="urgent-actions">
              <h4>Urgent Actions Required</h4>
              <ol>
                {exec.urgent_actions!.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {/* === STATEMENT OF FACTS === */}
      {(facts.chronology?.length ?? 0) + (facts.undisputed?.length ?? 0) + (facts.disputed?.length ?? 0) > 0 && (
        <section className="memo-section">
          <h2>Statement of Facts</h2>

          {(facts.chronology?.length ?? 0) > 0 && (
            <>
              <h3>I. Chronology</h3>
              <table className="chronology-table">
                <thead>
                  <tr>
                    <th style={{ width: "18%" }}>Date</th>
                    <th>Event</th>
                    <th style={{ width: "22%" }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {facts.chronology!.map((raw, i) => {
                    const e = parseChron(raw);
                    return (
                      <tr key={i}>
                        <td>{e.date || "—"}</td>
                        <td>{e.event}</td>
                        <td className="citation">{e.source}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {(facts.undisputed?.length ?? 0) > 0 && (
            <>
              <h3>II. Undisputed Facts</h3>
              <ul className="fact-list">
                {facts.undisputed!.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </>
          )}

          {(facts.disputed?.length ?? 0) > 0 && (
            <>
              <h3>III. Disputed Facts</h3>
              <ul className="fact-list disputed">
                {facts.disputed!.map((raw, i) => {
                  const d = parseDisputed(raw);
                  return (
                    <li key={i}>
                      {d.claim}
                      {d.opposing && <span className="opposing">Opposing view: {d.opposing}</span>}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {/* === LEGAL ANALYSIS (IRAC) === */}
      {irac.length > 0 && (
        <section className="memo-section">
          <h2>Legal Analysis</h2>
          {irac.map((issue, i) => (
            <div key={i} className="irac-block">
              <h3>
                {i + 1}. {issue.issue || "—"}
              </h3>
              {issue.rule && (
                <div className="irac-row">
                  <span className="irac-label">Rule</span>
                  <span className="irac-content">{issue.rule}</span>
                </div>
              )}
              {issue.application && (
                <div className="irac-row">
                  <span className="irac-label">Application</span>
                  <span className="irac-content">{issue.application}</span>
                </div>
              )}
              {issue.conclusion && (
                <div className="irac-row">
                  <span className="irac-label">Conclusion</span>
                  <span
                    className={`irac-content ${tokenClass("conclusion", issue.conclusion.split(/\s+/).slice(0, 2).join("-"))}`}
                  >
                    {issue.conclusion}
                  </span>
                </div>
              )}
              {(issue.cited_evidence?.length ?? 0) > 0 && (
                <div className="irac-row">
                  <span className="irac-label">Supporting Evidence</span>
                  <ul className="fact-list">
                    {issue.cited_evidence!.map((ce, j) => (
                      <li key={j} className="citation">
                        {ce}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* === RECOMMENDED MOTIONS === */}
      {motions.length > 0 && (
        <section className="memo-section">
          <h2>Recommended Motions</h2>
          {motions.map((m, i) => (
            <div key={i} className="motion-card">
              <div className="motion-header">
                <h3>{m.motion || "—"}</h3>
                {m.likelihood && (
                  <span className={`likelihood-badge ${tokenClass("likelihood", m.likelihood)}`}>{m.likelihood}</span>
                )}
              </div>
              {m.legal_standard && (
                <p>
                  <strong>Legal Standard: </strong>
                  {m.legal_standard}
                </p>
              )}
              {(m.factual_basis?.length ?? 0) > 0 && (
                <div>
                  <strong>Factual Basis:</strong>
                  <ul className="fact-list">
                    {m.factual_basis!.map((f, j) => (
                      <li key={j}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
              {m.draft_paragraph && (
                <div className="draft-paragraph">
                  <strong>Draft Paragraph:</strong>
                  <blockquote>{m.draft_paragraph}</blockquote>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* === EVIDENCE APPENDIX === */}
      {exhibits.length > 0 && (
        <section className="memo-section">
          <h2>Evidence Appendix</h2>
          <table className="evidence-table">
            <thead>
              <tr>
                <th style={{ width: "8%" }}>Exhibit</th>
                <th>Description</th>
                <th style={{ width: "8%" }}>Page</th>
                <th>Key Quote</th>
                <th>Proves</th>
                <th style={{ width: "10%" }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {exhibits.map((e, i) => (
                <tr key={i}>
                  <td className="exhibit-id">{e.exhibit || "—"}</td>
                  <td>{e.description || "—"}</td>
                  <td className="citation">{e.page || "—"}</td>
                  <td className="quote-cell">
                    {e.key_quote ? `"${e.key_quote.slice(0, 200)}${e.key_quote.length > 200 ? "…" : ""}"` : "—"}
                  </td>
                  <td>{e.proves || "—"}</td>
                  <td>
                    {e.admissibility_risk && (
                      <span className={`risk-badge ${tokenClass("risk", e.admissibility_risk)}`}>
                        {e.admissibility_risk}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* === RISK MATRIX === */}
      {risks.length > 0 && (
        <section className="memo-section">
          <h2>Risk Matrix</h2>
          <table className="risk-matrix">
            <thead>
              <tr>
                <th>Risk</th>
                <th style={{ width: "14%" }}>Probability</th>
                <th style={{ width: "14%" }}>Impact</th>
                <th>Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r, i) => (
                <tr key={i}>
                  <td>{r.risk || "—"}</td>
                  <td>
                    {r.probability && (
                      <span className={`risk-badge ${tokenClass("risk", r.probability)}`}>{r.probability}</span>
                    )}
                  </td>
                  <td>
                    {r.impact && <span className={`risk-badge ${tokenClass("risk", r.impact)}`}>{r.impact}</span>}
                  </td>
                  <td>{r.mitigation || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* === NEXT ACTIONS === */}
      {actions.length > 0 && (
        <section className="memo-section">
          <h2>Next Actions</h2>
          <table className="action-table">
            <thead>
              <tr>
                <th style={{ width: "12%" }}>Priority</th>
                <th>Action</th>
                <th style={{ width: "18%" }}>Owner</th>
                <th style={{ width: "18%" }}>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a, i) => (
                <tr key={i}>
                  <td>
                    {a.priority && (
                      <span className={`priority-badge ${tokenClass("priority", a.priority)}`}>{a.priority}</span>
                    )}
                  </td>
                  <td>{a.action || "—"}</td>
                  <td>{a.owner || "—"}</td>
                  <td>{a.deadline || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="memo-footer">
        Attorney-reviewed work product. Nyrava Intelligence-generated draft — verify all citations before filing.
      </p>

      <div className="memo-export-bar">

        <button
          type="button"
          className="memo-export-btn"
          onClick={async () => {
            try {
              const { downloadLegalMemoPdf } = await import("@/lib/export-legal-memo");
              downloadLegalMemoPdf(validated, caseName ?? "case");
            } catch (e) {
              toast.error(`PDF export failed: ${e instanceof Error ? e.message : "unknown"}`);
            }
          }}
        >
          Download PDF (.pdf)
        </button>
      </div>
    </article>
  );
}

export default LegalMemorandumPanel;
