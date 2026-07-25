// Real case-law grounding for legal issue hits (Report Intelligence).
//
// This module is intentionally fail-soft: any failure (missing token,
// network error, rate limit, bad response) returns an empty case_law
// array rather than throwing. It must never be able to break report
// generation — the report has always rendered fine without this data,
// so on any error we just render without it, same as before.
import type { LegalIssueHit } from "./report-augment.server";

export type CaseLawResult = {
  case_name: string;
  citation: string | null;
  court: string | null;
  date_filed: string | null;
  url: string;
  snippet: string;
};

// One curated search query per issue type we already detect in
// buildLegalIssues(). Kept separate from the detection regexes so this
// file can be edited independently of report-augment.server.ts.
const ISSUE_QUERY_MAP: Record<string, string> = {
  "Fourth Amendment": "fourth amendment warrantless search probable cause exclusionary rule",
  Miranda: "Miranda custodial interrogation waiver voluntariness",
  Franks: "Franks hearing false statement warrant affidavit",
  Brady: "Brady exculpatory evidence disclosure due process",
  Jencks: "Jencks Act prior statement disclosure witness",
  "Chain of Custody": "chain of custody evidence admissibility foundation",
  Authentication: "authentication business records exception hearsay foundation",
  "Expert Admissibility": "Daubert expert testimony methodology admissibility",
};

const COURTLISTENER_SEARCH_URL = "https://www.courtlistener.com/api/rest/v4/search/";

// Simple in-memory cache so a single report run never queries the same
// issue twice (e.g. buildLegalIssues is called more than once per report).
// This is per-server-instance and intentionally not persisted anywhere.
const runCache = new Map<string, CaseLawResult[]>();

/**
 * Search CourtListener for real, citable case law relevant to a given
 * free-text query. Returns [] on any failure — never throws.
 *
 * `opts.courtIds`, when provided, scopes the search to those CourtListener
 * court IDs (e.g. an attorney-selected state's supreme + appellate courts —
 * see jurisdictions.ts). If provided, a nationwide search runs concurrently
 * alongside the scoped one, and the scoped results are used only if
 * non-empty — persuasive out-of-state authority beats nothing, and the
 * caller has no way to distinguish "no such case exists" from "wrong
 * court ID." Both requests run in parallel so this never costs more than
 * one request's worth of latency, regardless of which one is used.
 */
export async function searchCaseLaw(
  query: string,
  opts: { maxResults?: number; courtIds?: string[] } = {},
): Promise<CaseLawResult[]> {
  const token = process.env.COURTLISTENER_API_TOKEN;
  if (!token) {
    console.warn("[case-law] COURTLISTENER_API_TOKEN not set — skipping case law lookup.");
    return [];
  }
  const courtFilter = opts.courtIds && opts.courtIds.length > 0 ? opts.courtIds.join(" ") : undefined;
  const cacheKey = `${query}::${courtFilter ?? ""}`;
  const cached = runCache.get(cacheKey);
  if (cached) return cached;

  const run = async (court?: string): Promise<CaseLawResult[] | null> => {
    try {
      const params = new URLSearchParams({
        q: query,
        type: "o", // opinions = case law
        order_by: "score desc",
      });
      if (court) params.set("court", court);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(`${COURTLISTENER_SEARCH_URL}?${params.toString()}`, {
          headers: { Authorization: `Token ${token}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        console.warn(`[case-law] CourtListener returned ${res.status} for query "${query}"`);
        return [];
      }

      const data = (await res.json()) as { results?: unknown[] };
      const rows = Array.isArray(data.results) ? data.results : [];
      const max = opts.maxResults ?? 3;

      return rows.slice(0, max).map((raw) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = raw as any;
        const citation = Array.isArray(r.citation) && r.citation.length > 0 ? String(r.citation[0]) : null;
        return {
          case_name: String(r.caseName ?? r.case_name ?? "Untitled case"),
          citation,
          court: r.court ? String(r.court) : null,
          date_filed: r.dateFiled ?? r.date_filed ?? null,
          url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : "https://www.courtlistener.com",
          snippet: String(r.snippet ?? "")
            .replace(/<\/?mark>/g, "")
            .slice(0, 400),
        };
      });
    } catch (err) {
      console.warn(`[case-law] lookup failed for query "${query}":`, err instanceof Error ? err.message : err);
      return null;
    }
  };

  // The scoped (jurisdiction-filtered) and nationwide searches run
  // CONCURRENTLY, not one after the other. They used to run sequentially
  // (scoped first, nationwide only as a fallback if scoped came back
  // empty) — which meant every issue whose court IDs didn't match
  // anything (a real risk, since those IDs are best-effort and unverified
  // — see jurisdictions.ts) paid two full request timeouts back to back
  // instead of one. That's enough to push a report-generation worker past
  // its execution budget on every single case that has a jurisdiction
  // set, which is consistent with reports "taking forever" after this
  // feature shipped. Running both at once keeps the worst case at one
  // request's timeout, no matter how many issues or whether jurisdiction
  // is set at all.
  let results: CaseLawResult[];
  if (courtFilter) {
    const [scoped, nationwide] = await Promise.all([run(courtFilter), run(undefined)]);
    if (scoped === null && nationwide === null) return [];
    results = scoped && scoped.length > 0 ? scoped : (nationwide ?? scoped ?? []);
  } else {
    const only = await run(undefined);
    if (only === null) return [];
    results = only;
  }

  runCache.set(cacheKey, results);
  return results;
}

/**
 * Takes the existing deterministic legal-issue hits and attaches real
 * case law to each one, keyed off the issue type (Fourth Amendment,
 * Miranda, Brady, etc). Never mutates input; never throws — on any
 * failure the issue is returned with case_law: [].
 *
 * `courtIds`, when provided, scopes every lookup to those courts (see
 * jurisdictions.ts) — typically the attorney-selected case jurisdiction.
 */
export async function attachCaseLaw(issues: LegalIssueHit[], courtIds?: string[]): Promise<LegalIssueHit[]> {
  // Only look up each distinct issue type once per report, not once per hit.
  const uniqueIssueTypes = Array.from(new Set(issues.map((i) => i.issue)));
  const byIssueType = new Map<string, CaseLawResult[]>();

  await Promise.all(
    uniqueIssueTypes.map(async (issueType) => {
      const query = ISSUE_QUERY_MAP[issueType];
      if (!query) {
        byIssueType.set(issueType, []);
        return;
      }
      const cases = await searchCaseLaw(query, { maxResults: 3, courtIds });
      byIssueType.set(issueType, cases);
    }),
  );

  return issues.map((i) => ({
    ...i,
    case_law: byIssueType.get(i.issue) ?? [],
  }));
}
