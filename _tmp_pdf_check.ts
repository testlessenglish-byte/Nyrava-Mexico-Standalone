(globalThis as any).document = { createElement: () => ({ click(){}, style:{}, setAttribute(){} }), body: { appendChild(){}, removeChild(){} } };
const jsPDFmod: any = await import("jspdf");
const captured: Record<string, ArrayBuffer> = {};
jsPDFmod.default.API.save = function (this: any, name: string) { captured[name] = this.output("arraybuffer"); return this; };
const { downloadPdf } = await import("./src/lib/export");
const base = (lang: string) => ({
  case: { id: "c1", name: `Fixture ${lang}`, case_type: "criminal_defense", report_language: lang, status: "completed" },
  documents: [{ id: "d1", filename: "carpeta.pdf", doc_index: 1, status: "completed" }],
  analysis: null, agents: [], score: null,
  report: { generated_language: lang, executive_summary: "Cadena de custodia del arma blanca comprometida.", facts: "Reconocimiento fotográfico irregular.", timeline_summary: "Hechos del 3 de marzo.", missing_evidence_report: "Falta dictamen pericial.", full_report: { validation: { finding_counters: { generated: 1, verified: 1 } }, intelligence: { consolidated_findings: [{ id: "f1" }] } } },
  findings: [{ id: "f1", title: "Cadena de custodia", severity: "critical", confidence: 0.8, description: "Sin registro", quote: "no consta registro" }],
} as any);
for (const lang of ["es", "en"]) downloadPdf(base(lang), `rep-${lang}`);
for (const [k, v] of Object.entries(captured)) { await Bun.write(`/tmp/rt/${k}`, v); console.log(k, v.byteLength); }
