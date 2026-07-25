/**
 * Nyrava Trust Badge — official secondary identity.
 *
 * Hand-coded SVG. Crisp from 16×16 favicon up to 512+ hero.
 * A metallic dark-navy shield with an electric-cyan illuminated "N".
 *
 * Variants:
 *   <TrustBadge />           default (48px, dark)
 *   <TrustBadgeSmall />      24px
 *   <TrustBadgeLarge />      160px, with soft outer glow
 *   <TrustBadgeMonochrome /> single-color, ideal for print
 *   <TrustBadgeOutline />    stroke-only, ideal for stamps / print
 *
 * The badge does NOT replace the NYRAVA wordmark. Pair with it in headers
 * via <TrustBadgeLockup /> or drop the shield alone as a security anchor.
 */

type Tone = "dark" | "light" | "mono";

interface TrustBadgeProps {
  size?: number;
  tone?: Tone;
  glow?: boolean;
  className?: string;
  title?: string;
}

const uid = (() => {
  let i = 0;
  return () => `tb-${++i}`;
})();

export function TrustBadge({
  size = 48,
  tone = "dark",
  glow = false,
  className = "",
  title = "Nyrava Trust Badge",
}: TrustBadgeProps) {
  const id = uid();
  const shieldFill = `url(#${id}-body)`;
  const edgeStroke = tone === "mono" ? "currentColor" : `url(#${id}-edge)`;
  const nFill = tone === "mono" ? "currentColor" : `url(#${id}-n)`;
  const showGlow = glow && tone !== "mono";

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 72"
      role="img"
      aria-label={title}
      style={showGlow ? { filter: "drop-shadow(0 0 18px rgba(94,234,212,0.45))" } : undefined}
    >
      <defs>
        {/* Shield body — metallic dark navy */}
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone === "light" ? "#F8FAFC" : "#0B1828"} />
          <stop offset="55%" stopColor={tone === "light" ? "#E2E8F0" : "#08111E"} />
          <stop offset="100%" stopColor={tone === "light" ? "#CBD5E1" : "#040A13"} />
        </linearGradient>
        {/* Edge — brushed silver → cyan */}
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E5F7F4" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#5EEAD4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0E7490" stopOpacity="0.85" />
        </linearGradient>
        {/* Inner top-light */}
        <linearGradient id={`${id}-gloss`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.14" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        {/* Illuminated N */}
        <linearGradient id={`${id}-n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A7F3E8" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
        {/* Soft inner cyan halo behind the N */}
        <radialGradient id={`${id}-halo`} cx="50%" cy="52%" r="42%">
          <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
          <stop offset="70%" stopColor="#22D3EE" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/*
        Shield silhouette — pointed base, softly rounded top corners.
        viewBox is 64×72; shield spans 4→60 wide, 4→68 tall.
      */}
      <path
        d="M32 4
           L58 10
           Q60 10.6 60 12.6
           L60 34
           C60 50 48 60 32 68
           C16 60 4 50 4 34
           L4 12.6
           Q4 10.6 6 10
           Z"
        fill={shieldFill}
        stroke={edgeStroke}
        strokeWidth={tone === "mono" ? 2 : 1.4}
        strokeLinejoin="round"
      />

      {/* Top gloss */}
      {tone !== "mono" && (
        <path
          d="M32 6 L56 11.4 Q57.6 11.8 57.6 13.4 L57.6 30 C42 34 22 34 6.4 30 L6.4 13.4 Q6.4 11.8 8 11.4 Z"
          fill={`url(#${id}-gloss)`}
        />
      )}

      {/* Cyan halo behind N */}
      {tone !== "mono" && <circle cx="32" cy="36" r="18" fill={`url(#${id}-halo)`} />}

      {/* Refined N — two pillars + diagonal blade, geometric and centered */}
      <g fill={nFill}>
        <rect x="20.5" y="24" width="4.6" height="24" rx="0.8" />
        <rect x="38.9" y="24" width="4.6" height="24" rx="0.8" />
        <path d="M25.1 24 L29 24 L43.5 48 L39.6 48 Z" />
      </g>
    </svg>
  );
}

export function TrustBadgeSmall(props: Omit<TrustBadgeProps, "size">) {
  return <TrustBadge size={24} {...props} />;
}

export function TrustBadgeLarge(props: Omit<TrustBadgeProps, "size" | "glow">) {
  return <TrustBadge size={168} glow {...props} />;
}

export function TrustBadgeMonochrome(props: Omit<TrustBadgeProps, "tone">) {
  return <TrustBadge tone="mono" {...props} />;
}

export function TrustBadgeOutline({
  size = 48,
  className = "",
  title = "Nyrava Trust Badge",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 72"
      role="img"
      aria-label={title}
      fill="none"
    >
      <path
        d="M32 4 L58 10 Q60 10.6 60 12.6 L60 34 C60 50 48 60 32 68 C16 60 4 50 4 34 L4 12.6 Q4 10.6 6 10 Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g fill="currentColor">
        <rect x="20.5" y="24" width="4.6" height="24" rx="0.8" />
        <rect x="38.9" y="24" width="4.6" height="24" rx="0.8" />
        <path d="M25.1 24 L29 24 L43.5 48 L39.6 48 Z" />
      </g>
    </svg>
  );
}

/**
 * TrustBadgeLockup — badge + NYRAVA wordmark, side-by-side.
 * Use in navigation, headers, and document covers where the primary
 * wordmark is already carrying the brand.
 */
export function TrustBadgeLockup({
  size = 40,
  subtitle = "LEGAL INTELLIGENCE OS",
  className = "",
}: {
  size?: number;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <TrustBadge size={size} glow />
      <div className="flex flex-col leading-none">
        <span className="font-display text-[15px] font-bold tracking-[0.22em] text-foreground">
          NYRAVA
        </span>
        {subtitle ? (
          <span className="mt-1 text-[8.5px] font-medium tracking-[0.32em] text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  );
}
