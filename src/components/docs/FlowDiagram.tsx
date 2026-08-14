// Generic accessible flow diagram — extracted from PipelineDiagram.tsx's
// rendering pattern so it can be reused with different, already-translated
// step labels (the About Us page's platform-architecture flow and its
// Continuous Legal Intelligence loop) without touching PipelineDiagram
// itself, which stays as-is for its existing callers (Trust Center, How It
// Works).
//
// role="img" + aria-label carries the full text alternative, so a screen
// reader gets the complete flow even though the visual is an SVG — no
// information here depends on color alone (steps are shown as labeled
// boxes with arrows, not color-coded dots).
export function FlowDiagram({
  steps,
  ariaLabel,
  caption,
  className = "",
}: {
  steps: string[];
  ariaLabel: string;
  caption?: string;
  className?: string;
}) {
  const W = 720;
  const stepH = 46;
  const gap = 12;
  const H = steps.length * (stepH + gap) + 20;
  return (
    <div className={`my-6 overflow-x-auto rounded-lg border border-border/60 bg-card/30 p-6 ${className}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        className="mx-auto block w-full max-w-[720px]"
      >
        <defs>
          <marker
            id="flow-diagram-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-primary" />
          </marker>
        </defs>
        {steps.map((s, i) => {
          const y = i * (stepH + gap) + 6;
          const isLast = i === steps.length - 1;
          return (
            <g key={`${s}-${i}`}>
              <rect
                x={W / 2 - 220}
                y={y}
                width={440}
                height={stepH}
                rx={10}
                className={isLast ? "fill-primary/20 stroke-primary" : "fill-card stroke-border"}
                strokeWidth={1}
              />
              <text
                x={W / 2}
                y={y + stepH / 2 + 5}
                textAnchor="middle"
                className="fill-foreground text-[14px] font-medium"
                style={{ fontFamily: "inherit" }}
              >
                {s}
              </text>
              {!isLast && (
                <line
                  x1={W / 2}
                  y1={y + stepH}
                  x2={W / 2}
                  y2={y + stepH + gap}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="text-primary/60"
                  markerEnd="url(#flow-diagram-arrow)"
                />
              )}
            </g>
          );
        })}
      </svg>
      {caption && <p className="mt-4 text-center text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}
