interface NyravaLogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  glow?: boolean;
  edition?: string;
}

/**
 * Nyrava primary logo lockup — México edition.
 * Wordmark: NYRAVA · LEGAL INTELLIGENCE OS · MÉXICO
 */
export function NyravaLogo({
  size = 40,
  withWordmark = false,
  className = "",
  glow = true,
  edition = "MÉXICO",
}: NyravaLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="relative"
        style={{ width: size, height: size }}
      >
        <img
          src="/brand/nyrava-eagle-logo.png"
          alt="Nyrava"
          className="relative z-10 h-full w-full object-contain"
        />
        {glow && (
          <div
            aria-hidden
            className="absolute inset-0 -z-0 rounded-full blur-xl"
            style={{ background: "radial-gradient(circle, rgba(216,179,106,0.35), transparent 70%)" }}
          />
        )}
      </div>
      {withWordmark && (
        <div className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-bold tracking-[0.22em] text-foreground" style={size >= 60 ? { fontSize: 20 } : undefined}>
            NYRAVA
          </span>
          <span className="mt-1 text-[8.5px] font-medium tracking-[0.32em] text-muted-foreground" style={size >= 60 ? { fontSize: 11, marginTop: 4 } : undefined}>
            LEGAL INTELLIGENCE OS · {edition}
          </span>
        </div>
      )}
    </div>
  );
}
