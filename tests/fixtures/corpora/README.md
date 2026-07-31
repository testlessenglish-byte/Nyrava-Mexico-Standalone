# Corpora de evidencia — Nyrava México

Expedientes ficticios de calidad *benchmark* para verificar los motores de
inteligencia (línea de tiempo, testigos, contradicciones, hallazgos,
puntajes) sobre contenido sustantivo en español mexicano.

Cada carpeta es un expediente completo: 15–30 documentos, partes ficticias
consistentes, cronología verificable, citas reales a códigos y leyes
mexicanas, y contradicciones plantadas de forma intencional.

## Expedientes incluidos

| Carpeta | Materia | Jurisdicción | Número |
| --- | --- | --- | --- |
| `benchmark_chiapas_familiar/` | Familiar | Estado de Chiapas — Tuxtla Gutiérrez | Juicio Oral Familiar 412/2026 |
| `benchmark_faro_penal/` | Penal | Quintana Roo — Benito Juárez (Cancún) | CI-FGE-QR/BJ/UIDFD/1120/2026 |
| `benchmark_faro_amparo/` | Amparo | Federal — Juzgado Primero de Distrito, Cancún | Amparo Indirecto 342/2026-II |
| `penal/` | Penal | Estado de Jalisco — Guadalajara | CI FGJ/JAL/UIP/00234/2026 |

Los acervos de relleno de cinco documentos (amparo, civil, familiar,
inmobiliario, laboral, mercantil) fueron eliminados: no cumplían el estándar
de expediente real.

## `_manifest.json` (obligatorio)

Cada carpeta incluye `_manifest.json` con la metadata completa del asunto
(título, expediente, juzgado, distrito judicial, juez, partes, abogados,
fecha de presentación, etapa procesal, próxima audiencia, prioridad, riesgo,
cuantía y autoridades aplicables). El sembrador la copia tal cual a
`cases.matter_metadata`, de modo que el asunto aparece completo sin edición
manual. El esquema vive en `src/lib/seed-metadata.ts`.

Los archivos que empiezan con `_` o `.`, y `README.md`, no se suben como
evidencia.

## Uso

Panel de administración → "Fixture corpora (diagnostics)" → seleccionar
expediente → "Seed new case". El servidor crea el `case` con metadata
completa, sube los documentos vía el pipeline real y devuelve el `case_id`.

Todos los datos son ficticios y de uso exclusivo para pruebas.
