import { useState } from "react";
import { ChevronDown, ChevronRight, Gavel, Scale } from "lucide-react";
import { useI18n } from "@/i18n";
import type { SeedMatterMetadata } from "@/lib/seed-metadata";

/** Renders structured Mexican court-file metadata attached to a matter. */
export function MatterMetadataCard({ metadata }: { metadata: unknown }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(true);

  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Partial<SeedMatterMetadata> & { corpus?: string };
  if (!m.courtCaseNumber && !m.courtName) return null;

  const fmtDate = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const rows: Array<[string, string | null | undefined]> = [
    [t("matterMeta.courtCaseNumber"), m.courtCaseNumber],
    [t("matterMeta.internalMatterNumber"), m.internalMatterNumber],
    [t("matterMeta.court"), m.courtName],
    [t("matterMeta.courtType"), m.courtType],
    [t("matterMeta.judicialDistrict"), m.judicialDistrict],
    [t("matterMeta.judge"), m.assignedJudge],
    [t("matterMeta.clerk"), m.courtClerk],
    [t("matterMeta.authority"), m.competentAuthority],
    [
      t("matterMeta.jurisdiction"),
      [m.jurisdiction, m.municipality].filter(Boolean).join(" — ") || null,
    ],
    [t("matterMeta.fuero"), m.fuero ? t(`matterMeta.fueroValue.${m.fuero}`) : null],
    [t("matterMeta.practiceArea"), [m.practiceArea, m.subPracticeArea].filter(Boolean).join(" · ") || null],
    [t("matterMeta.filingDate"), fmtDate(m.filingDate)],
    [t("matterMeta.proceduralStage"), m.proceduralStage],
    [t("matterMeta.nextHearing"), fmtDate(m.nextHearingDate)],
    [t("matterMeta.status"), m.caseStatus],
    [
      t("matterMeta.estimatedValue"),
      typeof m.estimatedValueMxn === "number"
        ? m.estimatedValueMxn.toLocaleString("es-MX", { style: "currency", currency: "MXN" })
        : null,
    ],
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Scale className="h-4 w-4 shrink-0 text-accent" />
        <h2 className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("matterMeta.title")}
        </h2>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm">
          <dl className="space-y-2">
            {rows
              .filter(([, v]) => Boolean(v))
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
                  <dd className="text-foreground">{value}</dd>
                </div>
              ))}
          </dl>

          {Array.isArray(m.relatedFileNumbers) && m.relatedFileNumbers.length > 0 && (
            <Section title={t("matterMeta.relatedFiles")}>
              <ul className="space-y-1">
                {m.relatedFileNumbers.map((r) => (
                  <li key={r} className="text-foreground">{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {Array.isArray(m.parties) && m.parties.length > 0 && (
            <Section title={t("matterMeta.parties")}>
              <ul className="space-y-2">
                {m.parties.map((p, i) => (
                  <li key={`${p.name}-${i}`}>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.role}</div>
                    <div className="text-foreground">{p.name}</div>
                    {p.detail && <div className="text-xs text-muted-foreground">{p.detail}</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {Array.isArray(m.attorneysOfRecord) && m.attorneysOfRecord.length > 0 && (
            <Section title={t("matterMeta.attorneys")}>
              <ul className="space-y-1">
                {m.attorneysOfRecord.map((a) => (
                  <li key={a} className="text-foreground">{a}</li>
                ))}
              </ul>
            </Section>
          )}

          {Array.isArray(m.opposingCounsel) && m.opposingCounsel.length > 0 && (
            <Section title={t("matterMeta.opposingCounsel")}>
              <ul className="space-y-1">
                {m.opposingCounsel.map((a) => (
                  <li key={a} className="text-foreground">{a}</li>
                ))}
              </ul>
            </Section>
          )}

          {Array.isArray(m.legalAuthorities) && m.legalAuthorities.length > 0 && (
            <Section title={t("matterMeta.legalAuthorities")}>
              <ul className="space-y-1">
                {m.legalAuthorities.map((a) => (
                  <li key={a} className="flex gap-2 text-xs text-foreground">
                    <Gavel className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {m.fictional && (
            <p className="rounded-md bg-secondary/60 px-2 py-1.5 text-[11px] text-muted-foreground">
              {t("matterMeta.fictionalNotice")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border pt-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
