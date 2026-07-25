// Attorney-facing jurisdiction list + mapping to CourtListener court IDs.
//
// This is intentionally the *state's* jurisdiction, not the case type — a
// California family case and a California criminal case both scope to the
// same California courts. Federal district/circuit coverage varies case by
// case (which circuit, which district) and isn't something a single
// dropdown can capture correctly, so "Federal" deliberately maps to no
// court filter (i.e. nationwide search, which naturally includes federal
// opinions) rather than guessing a circuit.
//
// The court IDs below follow CourtListener's documented ID conventions
// (state supreme court + primary intermediate appellate court) but were
// not individually verified against the live /api/rest/v4/courts/ list at
// write time. That's safe: searchCaseLaw() falls back to an unfiltered
// nationwide search whenever a jurisdiction-scoped query returns zero
// results, so a wrong or incomplete ID here degrades to "no filter" rather
// than silently hiding case law. Worth spot-checking against
// https://www.courtlistener.com/api/rest/v4/courts/?full_name__icontains=<state>
// if you notice a state consistently falling back.

export type JurisdictionOption = { value: string; label: string };

export const JURISDICTION_OPTIONS: JurisdictionOption[] = [
  { value: "federal", label: "Federal (no state court filter)" },
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "DC", label: "District of Columbia" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
];

export const JURISDICTION_VALUES = JURISDICTION_OPTIONS.map((o) => o.value) as [string, ...string[]];

// State -> CourtListener court IDs (highest court + primary intermediate
// appellate court). "federal" and unknown values intentionally have no
// entry, which callers should treat as "no court filter."
const COURT_IDS_BY_JURISDICTION: Record<string, string[]> = {
  AL: ["ala", "alacivapp", "alacrimapp"],
  AK: ["alaska", "alaskactapp"],
  AZ: ["ariz", "arizctapp"],
  AR: ["ark", "arkctapp"],
  CA: ["cal", "calctapp"],
  CO: ["colo", "coloctapp"],
  CT: ["conn", "connappct"],
  DE: ["del"],
  DC: ["dc"],
  FL: ["fla", "fladistctapp"],
  GA: ["ga", "gactapp"],
  HI: ["haw", "hawapp"],
  ID: ["idaho", "idahoctapp"],
  IL: ["ill", "illappct"],
  IN: ["ind", "indctapp"],
  IA: ["iowa", "iowactapp"],
  KS: ["kan", "kanctapp"],
  KY: ["ky", "kyctapp"],
  LA: ["la", "lactapp"],
  ME: ["me"],
  MD: ["md", "mdctspecapp"],
  MA: ["mass", "massappct"],
  MI: ["mich", "michctapp"],
  MN: ["minn", "minnctapp"],
  MS: ["miss", "missctapp"],
  MO: ["mo", "moctapp"],
  MT: ["mont"],
  NE: ["neb", "nebctapp"],
  NV: ["nev", "nevctapp"],
  NH: ["nh"],
  NJ: ["nj", "njsuperctappdiv"],
  NM: ["nm", "nmctapp"],
  NY: ["ny", "nyappdiv", "nyappterm"],
  NC: ["nc", "ncctapp"],
  ND: ["nd"],
  OH: ["ohio", "ohioctapp"],
  OK: ["okla", "oklacivapp", "oklacrimapp"],
  OR: ["or", "orctapp"],
  PA: ["pa", "pasuperct", "pacommwct"],
  RI: ["ri"],
  SC: ["sc", "scctapp"],
  SD: ["sd"],
  TN: ["tenn", "tennctapp", "tenncrimapp"],
  TX: ["tex", "texapp", "texcrimapp"],
  UT: ["utah", "utahctapp"],
  VT: ["vt"],
  VA: ["va", "vactapp"],
  WA: ["wash", "washctapp"],
  WV: ["wva"],
  WI: ["wis", "wisctapp"],
  WY: ["wyo"],
};

/**
 * Resolve an attorney-selected jurisdiction value to the CourtListener
 * court IDs to filter on. Returns undefined for "federal", unset, or any
 * unrecognized value — callers should treat that as "no filter."
 */
export function courtIdsForJurisdiction(jurisdiction: string | null | undefined): string[] | undefined {
  if (!jurisdiction) return undefined;
  const ids = COURT_IDS_BY_JURISDICTION[jurisdiction.toUpperCase()];
  return ids && ids.length > 0 ? ids : undefined;
}
