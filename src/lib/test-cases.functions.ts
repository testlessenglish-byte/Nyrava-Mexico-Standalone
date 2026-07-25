/**
 * Mexico test-case generator (admin).
 *
 * Generates realistic Mexican-law benchmark matters (Penal, Amparo, Civil,
 * Laboral, Familiar, Mercantil, Fiscal, etc.) into the caller's active
 * organization. Uses the Lovable AI Gateway with the Mexico legal lock so
 * every fixture stays inside Mexican civil-law terminology (Ministerio
 * Público, imputado, amparo, actor/demandado, LFT, CNPP...).
 *
 * Admins/owners only — verified with the caller's user_roles + org role.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { getAIProvider } from "./ai/provider.server";
import { mexicoLock } from "./engines/mexico-lock";

const MEXICAN_STATES = [
  "Federal","CDMX","Aguascalientes","Baja California","Baja California Sur","Campeche",
  "Chiapas","Chihuahua","Coahuila","Colima","Durango","Estado de México","Guanajuato",
  "Guerrero","Hidalgo","Jalisco","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca",
  "Puebla","Querétaro","Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco",
  "Tamaulipas","Tlaxcala","Veracruz","Yucatán","Zacatecas",
] as const;

const AREAS = [
  "penal","amparo","civil","laboral","familiar","mercantil","fiscal","administrativo",
] as const;

const Input = z.object({
  orgId: z.string().uuid(),
  area: z.enum(AREAS),
  state: z.enum(MEXICAN_STATES).default("Federal"),
  language: z.enum(["es","en"]).default("es"),
});

type Generated = {
  title: string;
  matter_type: string;
  reference_code: string;
  client_name: string;
  jurisdiction: string;
  court: string;
  docket_number: string;
  description: string;
  parties: { name: string; role: string }[];
  documents: { title: string; kind: string }[];
  legal_framework: string[];
};

const AREA_TO_MATTER_TYPE: Record<(typeof AREAS)[number],
  "criminal"|"constitutional"|"civil"|"labor"|"family"|"commercial"|"tax"|"administrative"> = {
  penal: "criminal",
  amparo: "constitutional",
  civil: "civil",
  laboral: "labor",
  familiar: "family",
  mercantil: "commercial",
  fiscal: "tax",
  administrativo: "administrative",
};

export const generateMexicoTestCase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Authorization: caller must be owner/admin of the org.
    const { data: membership, error: mErr } = await supabase
      .from("org_memberships")
      .select("role_in_org, status")
      .eq("org_id", data.orgId).eq("user_id", userId).maybeSingle();
    if (mErr) throw mErr;
    if (!membership || membership.status !== "active" || !["owner","admin"].includes(membership.role_in_org)) {
      throw new Error("Solo owner/admin puede generar casos de prueba.");
    }

    const provider = getAIProvider();
    const userPrompt = `Genera UN caso ficticio realista de prueba (benchmark) para Nyrava Intelligence México.

Parámetros:
- Área: ${data.area}
- Jurisdicción / Estado: ${data.state}
- Idioma: ${data.language === "en" ? "English" : "Español"}

Debe reflejar el sistema jurídico mexicano vigente. Nombres verosímiles (usa nombres hispanos), fechas coherentes (últimos 24 meses), número de expediente con formato mexicano (por ejemplo "123/2025" o "CNP/FED/${data.state === "Federal" ? "FED" : data.state.slice(0,3).toUpperCase()}/0123/2025"), tribunal correcto para el área y estado.

Ejemplos de tribunales por área:
- penal: Juzgado de Control / Tribunal de Enjuiciamiento del sistema penal acusatorio del Estado o Federal
- amparo: Juzgado de Distrito o Tribunal Colegiado de Circuito
- civil / familiar: Juzgado Civil / Familiar de Primera Instancia del Estado
- laboral: Tribunal Laboral Federal o Local (post-reforma)
- mercantil: Juzgado de Distrito Mercantil o Juzgado Civil con competencia mercantil
- fiscal: Sala Regional del TFJA
- administrativo: TFJA o tribunales administrativos locales

Devuelve SOLO JSON con esta forma exacta:
{
  "title": "string breve",
  "reference_code": "expediente estilo mexicano",
  "client_name": "nombre del cliente/representado",
  "jurisdiction": "${data.state}",
  "court": "tribunal específico",
  "docket_number": "número",
  "description": "3-5 párrafos con hechos, pretensiones, etapa procesal, usando terminología mexicana",
  "parties": [ { "name": "...", "role": "actor|demandado|imputado|víctima|ofendido|quejoso|autoridad responsable|tercero interesado|trabajador|patrón|contribuyente|autoridad fiscal" } ],
  "documents": [ { "title": "...", "kind": "carpeta_investigacion|informe_policial|dictamen_pericial|declaracion|demanda|contestacion|contrato|acta|resolucion|amparo|otro" } ],
  "legal_framework": [ "CPEUM art. ...", "CNPP art. ...", "LFT art. ...", "Ley de Amparo art. ...", "..." ]
}`;

    const { content } = await provider.chatJSON<Generated>(
      [
        { role: "system", content: mexicoLock(data.language) },
        { role: "system", content: "Devuelve ÚNICAMENTE JSON válido con la estructura solicitada. No incluyas explicaciones fuera del JSON." },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.7 },
    );

    // Persist the matter under the caller's identity (RLS applies).
    const matterType = AREA_TO_MATTER_TYPE[data.area];
    const { data: matter, error: insErr } = await supabase
      .from("matters")
      .insert({
        org_id: data.orgId,
        title: `[TEST] ${content.title}`,
        matter_type: matterType,
        practice_area: data.area,
        jurisdiction: data.state,
        court: content.court ?? null,
        docket_number: content.docket_number ?? null,
        reference_code: content.reference_code ?? null,
        client_name: content.client_name ?? null,
        description: content.description ?? null,
        status: "intake",
        priority: "normal",
        tags: ["test-case","mexico-benchmark", data.area],
        created_by: userId,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    // Seed parties
    if (Array.isArray(content.parties) && content.parties.length) {
      await supabase.from("matter_parties").insert(
        content.parties.slice(0, 12).map((p) => ({
          org_id: data.orgId,
          matter_id: matter.id,
          name: p.name,
          role: p.role,
        })),
      );
    }

    // Legal framework preview stored on knowledge base as unverified authorities.
    if (Array.isArray(content.legal_framework) && content.legal_framework.length) {
      await supabase.from("matter_knowledge").insert(
        content.legal_framework.slice(0, 25).map((c) => ({
          org_id: data.orgId,
          matter_id: matter.id,
          kind: "authority",
          title: c,
          language: data.language,
          data: { verified: false, source: "test-case-generator" },
          confidence: 0.3,
          created_by: userId,
        })),
      );
    }

    return {
      matterId: matter.id as string,
      generated: content,
    };
  });
