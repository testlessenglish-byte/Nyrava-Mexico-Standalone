// Resource Network — automatic population of publicly available contact
// information for official/public resources.
//
// Rules baked into this module:
//  * Only URLs registered in public.resource_official_sources are fetched,
//    and an extracted value is only kept when it belongs to one of that
//    source's allowed official domains. No search engines, no scraping of
//    random results, and no AI generation of contact data.
//  * A value is labelled "source_verified" only because it was read from the
//    official source itself. Administrator review remains "manually_verified".
//  * Administrator-corrected fields (admin_locked_fields) are never
//    overwritten by this job.
//  * This never runs on page load: it is driven centrally by the worker route
//    or an admin action, and users only read the stored directory.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type OfficialSourceRow = {
  slug: string;
  official_name: string;
  institution_type: string;
  jurisdiction_level: string;
  state_code: string | null;
  services: string[];
  coverage_levels: string[];
  populations: string[];
  source_urls: string[];
  source_type: string;
  allowed_domains: string[];
  website: string | null;
  refresh_interval_days: number;
  active: boolean;
};

export type RefreshOutcome = {
  slug: string;
  status: "updated" | "unchanged" | "skipped" | "failed";
  sourceUrl: string | null;
  fieldsUpdated: string[];
  detail?: string;
};

const USER_AGENT = "NyravaResourceDirectory/1.0 (+https://mexico.nyrava.com)";
const FETCH_TIMEOUT_MS = 20000;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Mexican phone shapes published on official pages: 55 1234 5678, 800 123 4567,
// (55) 1234-5678, +52 55 1234 5678.
const PHONE_RE = /(?:\+?52[\s-]?)?(?:\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}/g;

function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((d) => {
    const dom = d.toLowerCase().replace(/^\*\./, "");
    return h === dom || h.endsWith(`.${dom}`);
  });
}

function emailAllowed(email: string, allowed: string[]): boolean {
  const domain = email.split("@")[1] ?? "";
  return hostAllowed(domain, allowed);
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export type ExtractedContact = { phone?: string; email?: string; whatsapp?: string };

/** Pull contact values out of one official page. Structural only — no inference. */
export function extractContact(html: string, allowedDomains: string[]): ExtractedContact {
  const out: ExtractedContact = {};

  // mailto:/tel: links are the highest-confidence signal on a government page.
  const mailto = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => m[1]);
  const emails = [...mailto, ...(stripHtml(html).match(EMAIL_RE) ?? [])]
    .map((e) => e.trim().toLowerCase())
    .filter((e) => emailAllowed(e, allowedDomains))
    .filter((e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e));
  if (emails.length) out.email = emails[0];

  const tel = [...html.matchAll(/tel:([+\d\s().-]{7,})/gi)].map((m) => m[1]);
  const candidates = [...tel, ...(stripHtml(html).match(PHONE_RE) ?? [])];
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, "");
    const national = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
    if (national.length !== 10) continue;
    // Reject obvious non-phones (years, repeated digits, id numbers).
    if (/^(\d)\1+$/.test(national)) continue;
    out.phone = `${national.slice(0, 2)} ${national.slice(2, 6)} ${national.slice(6)}`;
    break;
  }
  return out;
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function loadOfficialSources(db: Db, slugs?: string[]): Promise<OfficialSourceRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (db as any).from("resource_official_sources").select("*").eq("active", true).order("slug");
  if (slugs?.length) q = q.in("slug", slugs);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as OfficialSourceRow[];
}

/** Ensure the directory row exists for a catalog entry; returns its id + current state. */
async function ensureInstitution(db: Db, source: OfficialSourceRow) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error } = await (db as any)
    .from("social_institutions")
    .select("id,phone,email,website,contact_verification,admin_locked_fields,source_verified_fields")
    .eq("source_slug", source.slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error: insertError } = await (db as any)
    .from("social_institutions")
    .insert({
      org_id: null,
      name: source.official_name,
      official_name: source.official_name,
      institution_type: source.institution_type,
      jurisdiction_level: source.jurisdiction_level,
      services: source.services,
      populations: source.populations,
      coverage_levels: source.coverage_levels,
      state_code: source.state_code,
      website: source.website,
      source_slug: source.slug,
      source_url: source.website,
      source_type: source.source_type,
      contact_verification: "source_verified",
      source_verified_fields: source.website ? ["website"] : [],
      active: true,
    })
    .select("id,phone,email,website,contact_verification,admin_locked_fields,source_verified_fields")
    .single();
  if (insertError) throw new Error(insertError.message);
  return created;
}

/**
 * Refresh one catalogued source. Never throws: the outcome is returned and
 * logged so one unreachable ministry site cannot stop the rest.
 */
export async function refreshOneSource(db: Db, source: OfficialSourceRow): Promise<RefreshOutcome> {
  const startedAt = new Date().toISOString();
  let institutionId: string | null = null;
  const outcome = async (o: RefreshOutcome) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).from("resource_contact_refresh_runs").insert({
      slug: o.slug,
      institution_id: institutionId,
      status: o.status,
      source_url: o.sourceUrl,
      fields_updated: o.fieldsUpdated,
      detail: o.detail ?? null,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
    });
    return o;
  };

  let current: {
    id: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    contact_verification: string;
    admin_locked_fields: string[];
    source_verified_fields: string[];
  };
  try {
    current = await ensureInstitution(db, source);
    institutionId = current.id;
  } catch (e) {
    return outcome({ slug: source.slug, status: "failed", sourceUrl: null, fieldsUpdated: [], detail: String(e) });
  }

  let extracted: ExtractedContact = {};
  let usedUrl: string | null = null;
  let lastError = "";
  for (const url of source.source_urls) {
    try {
      const host = new URL(url).hostname;
      if (!hostAllowed(host, source.allowed_domains)) {
        lastError = `URL host ${host} is not in the approved domain list`;
        continue;
      }
      const html = await fetchPage(url);
      const found = extractContact(html, source.allowed_domains);
      usedUrl = url;
      extracted = { ...found, ...extracted };
      if (extracted.phone && extracted.email) break;
    } catch (e) {
      lastError = String(e);
    }
  }

  if (!usedUrl) {
    return outcome({ slug: source.slug, status: "failed", sourceUrl: null, fieldsUpdated: [], detail: lastError || "No official source reachable" });
  }

  const locked = new Set(current.admin_locked_fields ?? []);
  const manuallyVerified = current.contact_verification === "manually_verified";
  const updates: Record<string, unknown> = {};
  const changed: string[] = [];

  const consider = (field: "phone" | "email" | "website", value?: string | null) => {
    if (!value) return;
    if (locked.has(field)) return; // administrator correction wins
    const existing = (current as Record<string, unknown>)[field] as string | null;
    if (existing && manuallyVerified) return; // never downgrade admin-confirmed data
    if (existing === value) return;
    updates[field] = value;
    changed.push(field);
  };

  consider("phone", extracted.phone);
  consider("email", extracted.email);
  consider("website", source.website);

  const verifiedFields = Array.from(new Set([...(current.source_verified_fields ?? []), ...changed]));
  Object.assign(updates, {
    source_url: usedUrl,
    source_type: source.source_type,
    last_checked_at: new Date().toISOString(),
    source_verified_fields: verifiedFields,
    updated_at: new Date().toISOString(),
  });
  if (!manuallyVerified && verifiedFields.length) updates.contact_verification = "source_verified";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("social_institutions").update(updates).eq("id", current.id);
  if (error) {
    return outcome({ slug: source.slug, status: "failed", sourceUrl: usedUrl, fieldsUpdated: [], detail: error.message });
  }

  return outcome({
    slug: source.slug,
    status: changed.length ? "updated" : "unchanged",
    sourceUrl: usedUrl,
    fieldsUpdated: changed,
  });
}

export async function refreshOfficialContacts(db: Db, slugs?: string[]): Promise<RefreshOutcome[]> {
  const sources = await loadOfficialSources(db, slugs);
  const results: RefreshOutcome[] = [];
  for (const source of sources) {
    results.push(await refreshOneSource(db, source));
  }
  return results;
}
