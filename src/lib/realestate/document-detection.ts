// Intelligent document detection for a property file.
//
// Phase 1 only looked at filenames. This layer reads the OCR/extraction text
// the pipeline already stores on `documents.extracted_text` and decides which
// of the instruments a Mexican property closing depends on are actually
// present — a file named "scan_004.pdf" that contains "CERTIFICADO DE
// LIBERTAD DE GRAVAMEN" now counts, and a file named "escritura.pdf" that is
// really a utility bill no longer does on text alone.
//
// Pure, deterministic and offline: no AI quota is spent here. The AI
// assistant inside the verification workspace remains the place for reasoning
// about a document's contents.

export type DocumentKind =
  | "deed"
  | "purchase_agreement"
  | "registry_certificate"
  | "mortgage_release"
  | "predial_receipt"
  | "power_of_attorney"
  | "identity"
  | "water_clearance"
  | "cfe_clearance"
  | "hoa_clearance"
  | "catastro"
  | "permits"
  | "environmental"
  | "appraisal";

export type PropertyDocument = {
  id: string;
  filename: string;
  /** Excerpt of the extracted/OCR text, when extraction has run. */
  text?: string | null;
};

export type DetectedDocument = {
  kind: DocumentKind;
  documentId: string;
  filename: string;
  /** "text" when matched on OCR content, "filename" when only the name matched. */
  matchedOn: "text" | "filename";
};

type Rule = {
  kind: DocumentKind;
  filename: RegExp;
  /** Phrases that only appear inside the real instrument. */
  text: RegExp;
};

const RULES: Rule[] = [
  {
    kind: "deed",
    filename: /escritura|titulo|t[ií]tulo|deed/,
    text: /escritura\s+p[uú]blica|instrumento\s+p[uú]blico|fe\s+de\s+hechos|protocolo\s+a\s+mi\s+cargo|volumen\s+\w+\s+libro/,
  },
  {
    kind: "purchase_agreement",
    filename: /compraventa|promesa|contrato|purchase|agreement/,
    text: /contrato\s+de\s+compraventa|promesa\s+de\s+compraventa|cl[aá]usulas?\b.*(vendedor|comprador)|precio\s+de\s+la\s+operaci[oó]n/,
  },
  {
    kind: "registry_certificate",
    filename: /libertad|gravamen|certificado|rpp|registro/,
    text: /certificado\s+de\s+libertad|libertad\s+de\s+gravamen|registro\s+p[uú]blico\s+de\s+la\s+propiedad|folio\s+real/,
  },
  {
    kind: "mortgage_release",
    filename: /cancelaci[oó]n|liberaci[oó]n|hipoteca|mortgage/,
    text: /cancelaci[oó]n\s+de\s+hipoteca|liberaci[oó]n\s+de\s+(la\s+)?hipoteca|carta\s+de\s+(no\s+)?adeudo.*(cr[eé]dito|hipotec)|extinci[oó]n\s+del\s+cr[eé]dito/,
  },
  {
    kind: "predial_receipt",
    filename: /predial|impuesto\s*predial/,
    text: /impuesto\s+predial|cuenta\s+predial|constancia\s+de\s+no\s+adeudo\s+predial|tesorer[ií]a\s+municipal/,
  },
  {
    kind: "power_of_attorney",
    filename: /poder|mandato|apoderad/,
    text: /poder\s+(general|especial)|mandato\s+(general|especial)|para\s+actos\s+de\s+dominio|apoderado\s+legal/,
  },
  {
    kind: "identity",
    filename: /ine|curp|identificaci[oó]n|pasaporte|acta|passport/,
    text: /instituto\s+nacional\s+electoral|clave\s+de\s+elector|\bcurp\b|acta\s+de\s+nacimiento|pasaporte/,
  },
  {
    kind: "water_clearance",
    filename: /agua|sapal|siapa|water/,
    text: /organismo\s+operador\s+de\s+agua|no\s+adeudo.*agua|servicio\s+de\s+agua\s+potable/,
  },
  {
    kind: "cfe_clearance",
    filename: /cfe|luz|electric/,
    text: /comisi[oó]n\s+federal\s+de\s+electricidad|\bcfe\b|suministro\s+el[eé]ctrico/,
  },
  {
    kind: "hoa_clearance",
    filename: /condominio|hoa|mantenimiento|administraci[oó]n/,
    text: /r[eé]gimen\s+de\s+propiedad\s+en\s+condominio|cuotas?\s+de\s+mantenimiento|reglamento\s+de\s+condominio/,
  },
  {
    kind: "catastro",
    filename: /catastr|cadastr/,
    text: /clave\s+catastral|direcci[oó]n\s+de\s+catastro|plano\s+catastral/,
  },
  {
    kind: "permits",
    filename: /licencia|permiso|uso\s*de\s*suelo|permit/,
    text: /licencia\s+de\s+construcci[oó]n|uso\s+de\s+suelo|desarrollo\s+urbano/,
  },
  {
    kind: "environmental",
    filename: /ambiental|profepa|semarnat|environment/,
    text: /manifestaci[oó]n\s+de\s+impacto\s+ambiental|profepa|semarnat|[aá]rea\s+natural\s+protegida/,
  },
  {
    kind: "appraisal",
    filename: /aval[uú]o|appraisal/,
    text: /aval[uú]o\s+(comercial|bancario)|perito\s+valuador|valor\s+de\s+mercado/,
  },
];

function norm(s: string): string {
  return s.toLowerCase();
}

/** Detects which instruments are present across the case's documents. */
export function detectDocuments(documents: PropertyDocument[]): DetectedDocument[] {
  const found = new Map<DocumentKind, DetectedDocument>();

  for (const doc of documents) {
    const name = norm(doc.filename ?? "");
    const text = doc.text ? norm(doc.text) : "";
    for (const rule of RULES) {
      const byText = text.length > 0 && rule.text.test(text);
      const byName = rule.filename.test(name);
      if (!byText && !byName) continue;
      const candidate: DetectedDocument = {
        kind: rule.kind,
        documentId: doc.id,
        filename: doc.filename,
        matchedOn: byText ? "text" : "filename",
      };
      const prev = found.get(rule.kind);
      // A text match always beats a filename-only match.
      if (!prev || (prev.matchedOn === "filename" && candidate.matchedOn === "text")) {
        found.set(rule.kind, candidate);
      }
    }
  }

  return [...found.values()];
}

export function detectionMap(detected: DetectedDocument[]): Map<DocumentKind, DetectedDocument> {
  return new Map(detected.map((d) => [d.kind, d]));
}
