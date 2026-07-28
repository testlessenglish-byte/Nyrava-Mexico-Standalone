// Official Mexican government resources used during a property transaction.
// Pure data + URL builders — no network calls, no AI. These are the same
// sources an attorney would otherwise search for by hand across several
// government portals; centralizing them here means the Transaction Center
// (and the recommendation engine) can deep-link straight into them.

export type OfficialResourceId =
  | "sat"
  | "rpp_federal"
  | "notarios_federales"
  | "notarios_nacionales"
  | "registro_civil";

export type OfficialResource = {
  id: OfficialResourceId;
  url: string;
  /** Secondary official link (e.g. the current published directory PDF). */
  secondaryUrl?: string;
  /** i18n key suffixes resolve as `re.res.<id>.name` / `.desc` / `.secondary`. */
};

export const OFFICIAL_RESOURCES: OfficialResource[] = [
  {
    id: "sat",
    url: "https://www.sat.gob.mx",
  },
  {
    id: "rpp_federal",
    url: "https://www.gob.mx/tramites/ficha/busqueda-de-antecedentes-registrales-en-el-registro-publico-de-la-propiedad-federal/INDAABIN3984",
  },
  {
    id: "notarios_federales",
    url: "https://www.gob.mx/indaabin/acciones-y-programas/notarios-del-patrimonio-inmobiliario-federal",
    secondaryUrl:
      "https://www.gob.mx/indaabin/documentos/lista-de-notarios-del-patrimonio-inmobiliario-federal-164466",
  },
  {
    id: "notarios_nacionales",
    url: "https://fedatariospublicos.org.mx",
  },
  {
    id: "registro_civil",
    url: "https://www.miregistrocivil.gob.mx",
  },
];

export function resourceById(id: OfficialResourceId): OfficialResource {
  return OFFICIAL_RESOURCES.find((r) => r.id === id) ?? OFFICIAL_RESOURCES[0];
}

/** SAT RFC validation tool ("Validación de RFC"). */
export const SAT_RFC_VALIDATION_URL =
  "https://portalsat.plataforma.sat.gob.mx/ConsultaRFC/";

/** SAT CFDI validation tool. */
export const SAT_CFDI_VALIDATION_URL =
  "https://verificacfdi.facturaelectronica.sat.gob.mx/";

/**
 * Notary directory search, pre-filtered by city/state when the property
 * record already tells us where the transaction is happening.
 */
export function notaryDirectorySearchUrl(place?: string | null): string {
  const base = "https://fedatariospublicos.org.mx";
  if (!place?.trim()) return base;
  return `https://www.google.com/search?q=${encodeURIComponent(
    `notario público ${place.trim()} site:fedatariospublicos.org.mx`,
  )}`;
}
