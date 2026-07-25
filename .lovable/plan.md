# Nyrava México — Deep-Build: Civil, Familiar, Laboral

Scope locked by your answers:
- **Deep-build 3 domains**: `general_civil` (Derecho Civil), `family` (Derecho Familiar), `employment` (Derecho Laboral).
- **Template**: match the depth of the existing `criminal` + `amparo` implementation.
- **Test cases**: both fixed fixtures under `tests/fixtures/corpora/mx/` and generator presets in `/admin/test-cases`.
- **Everything else** (17 remaining domains from your list, from Mercantil to Comercio Internacional) stays as classification-only stubs for now — I will list them in the Coverage Dashboard as ❌ so you can see the gap, and we tackle them in later waves.

## Phases

### Phase A — Coverage inventory (foundation)
1. Build `src/lib/intelligence/mx-coverage.ts`: the source-of-truth registry that lists every domain × 12 capability dimensions (classification, terminology, doc types, evidence rules, timeline rules, contradictions, applicable laws, report template, Talk-to-Case prompt, ES/EN parity, hallucination controls, citation verification) and reads the current codebase to compute ✅ / ⚠️ / ❌ per cell.
2. Build `/admin/legal-coverage` route rendering that matrix as a real dashboard (filter by domain, click a cell to see what's missing/present, export JSON). Gated `super_admin` only.

Deliverable: you can see exactly what exists today before I add anything.

### Phase B — Mexicanize the 3 target domains
For each of Civil, Familiar, Laboral, ship the same 12 capabilities that Penal already has:

1. **Terminology & blocklist** — extend `src/i18n/legal-terms.ts` and `PRACTICE_BLOCKED_TERMS` in `practice-areas.ts` with the MX vocabulary from your list (contratos, daño moral, guarda y custodia, patria potestad, pensión alimenticia, despido injustificado, aguinaldo, IMSS, etc.). Common-law drift terms already blocked project-wide via `FORBIDDEN_COMMON_LAW_TERMS`.
2. **Document classifiers** — add MX doc-type recognizers under `src/lib/intelligence/extract.server.ts` (contrato, escritura pública, acta de matrimonio, convenio regulador, contrato individual de trabajo, recibos de nómina, constancia IMSS, aviso de rescisión, etc.).
3. **Evidence rules** — per-domain evidence-gate rules in `evidence-gate.server.ts` (probanzas admissibility by Mexican civil/family/labor procedure — documental, testimonial, pericial, confesional, presuncional).
4. **Applicable-laws registry** — hard-link each domain to the required primary sources: CCF + códigos civiles estatales (Civil), CCF familia + códigos familiares estatales + Ley General de los Derechos de Niñas, Niños y Adolescentes (Familiar), LFT + Ley del Seguro Social + jurisprudencia laboral SCJN (Laboral).
5. **Finding modules** — extend `PRACTICE_FINDING_MODULES` with MX-specific engines: `engine:incumplimiento_contractual:*`, `engine:danio_moral:*`, `engine:guarda_custodia:*`, `engine:pension_alimenticia:*`, `engine:despido_injustificado:*`, `engine:prestaciones_pendientes:*`.
6. **Motion / promoción types** — replace US motions in `PRACTICE_MOTION_TYPES` with MX promociones: demanda inicial, contestación, ofrecimiento de pruebas, alegatos, convenio de divorcio, demanda laboral ante tribunal laboral, etc.
7. **Report sections** — MX-shaped report templates in `report-canonical-context.ts` and `report-augment.server.ts` (Hechos, Fundamentos de derecho, Pruebas, Puntos petitorios).
8. **Timeline & contradictions** — pass through existing universal engines; add MX-specific plazo rules (plazos procesales del CFPC / LFT / código familiar) into `canonical-timeline.server.ts`.
9. **Talk-to-Case prompts** — MX-tuned system prompts per domain in `chat.server.ts`.
10. **Bilingual output** — verified via existing `report_language` field; every new prompt honors `getReportLocale`.
11. **Hallucination controls** — reuse `hallucination.server.ts` + Mexico Lock preamble; add domain-specific "must-cite" gates (e.g., every despido finding must cite an LFT article).
12. **Citation verification** — extend `legal-authority-verify.server.ts` allow-list with the primary sources for each domain.

### Phase C — Verification test cases (7)
Fixed fixtures under `tests/fixtures/corpora/mx/`:
- `penal_homicidio/` (carpeta de investigación + IPH + peritajes)
- `amparo_indirecto/` (demanda de amparo + acto reclamado + informe justificado)
- `laboral_despido/` (contrato + recibos + aviso de rescisión + demanda ante tribunal laboral)
- `familiar_custodia/` (demanda de guarda y custodia + estudio socioeconómico + convenio)
- `civil_propiedad/` (escritura + contrato + peritaje de avalúo)
- `fiscal_sat/` (resolución determinante + recurso de revocación) — classification-only stub
- `ambiental/` (denuncia ante PROFEPA) — classification-only stub

Plus preset buttons in `/admin/test-cases` that seed each fixture as a real matter for end-to-end validation. A vitest suite `mx-coverage.test.ts` runs each fixture through classification → extraction → findings and asserts: correct jurisdiction, correct area, ES output, applicable laws detected, no forbidden common-law terms.

## Technical notes

- **Database**: no new tables needed. Domain metadata lives in TypeScript (`practice-areas.ts`, `mx-coverage.ts`) — this is how the existing framework already works and lets tests import registries directly.
- **AI**: all engines already route through Lovable AI Gateway with the Mexico Lock preamble; the work is prompt/rule content, not new infrastructure.
- **Non-goals for this pass**: I will NOT deep-build Mercantil, Administrativo, Constitucional (standalone), Derechos Humanos, Fiscal, Ambiental, Migratorio, Agrario, Electoral, Energético, Minero, Propiedad Intelectual, PROFECO, Datos Personales, or Comercio Internacional. They will appear in the Coverage Dashboard as ❌ with the specific missing capabilities enumerated, so we can plan later waves off real data instead of guessing.

## Estimated turns
- Phase A: ~2 turns (registry + dashboard route)
- Phase B: ~4 turns (one turn per domain + one for shared plumbing)
- Phase C: ~2 turns (fixtures + generator presets + vitest suite)

Approve and I'll start with Phase A.
