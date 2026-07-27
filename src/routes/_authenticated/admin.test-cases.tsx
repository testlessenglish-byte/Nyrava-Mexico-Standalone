import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentOrgId } from "@/lib/workspace";
import { generateMexicoTestCase } from "@/lib/test-cases.functions";
import { FlaskConical, Loader2, ShieldAlert } from "lucide-react";

/**
 * Admin — Mexico Test Case Generator.
 *
 * Genera casos ficticios de prueba (benchmark) en la organización activa,
 * usando exclusivamente el sistema jurídico mexicano. Solo owner/admin.
 */
export const Route = createFileRoute("/_authenticated/admin/test-cases")({
  head: () => ({ meta: [{ title: "Generador de casos · Nyrava México" }] }),
  component: TestCasesAdmin,
});

const AREAS = [
  { code: "penal", label: "Penal (CNPP)" },
  { code: "amparo", label: "Amparo (Ley de Amparo)" },
  { code: "civil", label: "Civil (CCF / códigos estatales)" },
  { code: "laboral", label: "Laboral (LFT)" },
  { code: "familiar", label: "Familiar" },
  { code: "mercantil", label: "Mercantil (CCom / LGSM)" },
  { code: "fiscal", label: "Fiscal (CFF / TFJA)" },
  { code: "administrativo", label: "Administrativo" },
] as const;

const STATES = [
  "Federal","CDMX","Aguascalientes","Baja California","Baja California Sur","Campeche",
  "Chiapas","Chihuahua","Coahuila","Colima","Durango","Estado de México","Guanajuato",
  "Guerrero","Hidalgo","Jalisco","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca",
  "Puebla","Querétaro","Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco",
  "Tamaulipas","Tlaxcala","Veracruz","Yucatán","Zacatecas",
] as const;

function TestCasesAdmin() {
  const navigate = useNavigate();
  const orgId = getCurrentOrgId();
  const generate = useServerFn(generateMexicoTestCase);
  const [area, setArea] = useState<typeof AREAS[number]["code"]>("penal");
  const [state, setState] = useState<(typeof STATES)[number]>("Yucatán");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof generateMexicoTestCase>> | null>(null);

  async function run() {
    if (!orgId) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await generate({ data: { orgId, area, state, language: "es" } });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar caso.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div className="panel p-6">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-1 h-5 w-5 text-primary" />
          <div>
            <h1 className="font-display text-xl font-semibold">Benchmark México</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Genera un asunto ficticio realista para validar los motores de Inteligencia Legal, de Caso y de Evidencia.
              Cada caso queda etiquetado <code className="rounded bg-muted px-1">test-case</code> y se crea en tu organización activa.
              Todos los prompts operan bajo el <strong>Mexico Legal Lock</strong>: no se utilizan términos ni figuras del common law.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Área jurídica</span>
            <select value={area} onChange={(e) => setArea(e.target.value as typeof area)}
              className="mt-1 w-full rounded border border-border bg-background p-2 text-sm">
              {AREAS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Jurisdicción / Estado</span>
            <select value={state} onChange={(e) => setState(e.target.value as typeof state)}
              className="mt-1 w-full rounded border border-border bg-background p-2 text-sm">
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <button
          onClick={run}
          disabled={loading || !orgId}
          className="mt-6 inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          Generar caso benchmark
        </button>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 h-4 w-4" /> {error}
          </div>
        )}

        {result && (
          <div className="mt-6 rounded border border-border/60 bg-muted/20 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Caso generado</div>
            <h2 className="mt-1 font-display text-lg font-semibold">{result.generated.title}</h2>
            <div className="mt-1 text-xs text-muted-foreground">
              {result.generated.court} · Exp. {result.generated.docket_number} · {result.generated.jurisdiction}
            </div>
            <p className="mt-3 whitespace-pre-line text-sm">{result.generated.description}</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Partes</div>
                <ul className="mt-1 space-y-1 text-sm">
                  {result.generated.parties?.map((p, i) => (
                    <li key={i}><strong>{p.name}</strong> — <span className="text-muted-foreground">{p.role}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Marco jurídico</div>
                <ul className="mt-1 space-y-1 text-sm">
                  {result.generated.legal_framework?.map((c, i) => <li key={i}>· {c}</li>)}
                </ul>
              </div>
            </div>

            <button
              onClick={() => navigate({ to: "/cases/$caseId", params: { caseId: result.caseId } })}
              className="mt-6 inline-flex items-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"
            >
              Abrir asunto →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
