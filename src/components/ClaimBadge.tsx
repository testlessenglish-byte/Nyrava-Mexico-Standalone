import { CLAIM_BADGE_CLASS, classifyClaim, type ClaimClass } from "@/lib/intelligence/claim-class";
import { useI18n } from "@/i18n";

export function ClaimBadge({
  text,
  hint,
  className,
}: {
  text?: string;
  hint?: ClaimClass | null;
  className?: string;
}) {
  const { t } = useI18n();
  const cls = classifyClaim(text ?? "", hint ?? null);
  const label = t(`claim.${cls}`);
  return (
    <span
      className={
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
        CLAIM_BADGE_CLASS[cls] +
        (className ? " " + className : "")
      }
      title={label}
    >
      {label}
    </span>
  );
}

export default ClaimBadge;
