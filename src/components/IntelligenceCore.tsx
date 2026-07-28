import { NyravaLogo } from "./NyravaLogo";

/**
 * Nyrava Intelligence Core — animated orbital emblem.
 * Subtle rotating rings + soft cyan pulse around the official "N" tile.
 */
export function IntelligenceCore({ size = 360 }: { size?: number }) {
  const s = size;
  return (
    <div
      className="relative grid place-items-center"
      style={{ width: s, height: s }}
      aria-hidden="true"
    >
      {/* Outer halo */}
      <div
        className="absolute inset-0 rounded-full animate-pulse-ring"
        style={{
          background:
            "radial-gradient(circle, rgba(216,179,106,0.18) 0%, transparent 62%)",
        }}
      />
      {/* Orbit ring 1 */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full animate-spin-slow"
      >
        <circle
          cx="100"
          cy="100"
          r="92"
          fill="none"
          stroke="rgba(216,179,106,0.35)"
          strokeWidth="0.5"
          strokeDasharray="2 6"
        />
        <circle cx="100" cy="8" r="2" fill="oklch(0.88 0.13 195)" />
        <circle cx="180" cy="140" r="1.5" fill="oklch(0.88 0.13 195 / 0.7)" />
      </svg>
      {/* Orbit ring 2 (reverse) */}
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full animate-spin-reverse-slow"
      >
        <ellipse
          cx="100"
          cy="100"
          rx="78"
          ry="42"
          fill="none"
          stroke="rgba(216,179,106,0.25)"
          strokeWidth="0.5"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="42"
          ry="78"
          fill="none"
          stroke="rgba(216,179,106,0.25)"
          strokeWidth="0.5"
        />
      </svg>
      {/* Inner ring (static) */}
      <div
        className="absolute rounded-full border"
        style={{
          width: s * 0.46,
          height: s * 0.46,
          borderColor: "rgba(216,179,106,0.45)",
          boxShadow: "0 0 40px rgba(216,179,106,0.35), inset 0 0 30px rgba(216,179,106,0.15)",
        }}
      />
      {/* Core logo */}
      <div className="relative">
        <NyravaLogo size={Math.round(s * 0.22)} glow />
      </div>
      {/* Base plate */}
      <div
        className="absolute bottom-4 h-1 w-1/3 rounded-full"
        style={{ background: "linear-gradient(90deg, transparent, rgba(216,179,106,0.5), transparent)" }}
      />
    </div>
  );
}
