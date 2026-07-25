# Corpora de evidencia — Nyrava México

Corpus sintéticos de matter management para verificar los motores de
inteligencia (línea de tiempo, testigos, contradicciones, hallazgos,
puntajes) sobre contenido sustantivo en español mexicano.

Cada carpeta corresponde a un área de práctica mexicana registrada en
`src/lib/intelligence/practice-areas.ts` y `mx-coverage.ts`.

## Áreas cubiertas

- `penal/` — Derecho Penal (CNPP, CPF)
- `amparo/` — Juicio de Amparo (Ley de Amparo, CPEUM)
- `laboral/` — Derecho Laboral (LFT, reforma 2019)
- `civil/` — Derecho Civil (CCF, CFPC)
- `familiar/` — Derecho Familiar (CCF, códigos estatales)
- `mercantil/` — Derecho Mercantil (CCom, LGSM, LGTOC)

Cada corpus contiene documentos plausibles (carpetas de investigación,
demandas, contestaciones, actas, dictámenes, testimoniales) con partes
ficticias, hechos internamente consistentes, y citas reales a códigos y
leyes mexicanas. No hay terminología estadounidense.

## Uso

Panel de administración → "Fixture corpora (diagnostics)" → seleccionar
área → "Seed new case". El servidor crea un `case` nuevo, sube los
documentos vía el pipeline real y devuelve el `case_id`.
