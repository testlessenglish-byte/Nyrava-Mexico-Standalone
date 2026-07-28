// Renders the markdown subset chat/case-intelligence responses actually
// emit: #/##/### headings, **bold**/*italic* inline text, pipe tables
// (| a | b | with a |---|---| separator row), numbered and "- " bulleted
// lists, and plain paragraphs. The chat panel was previously dumping raw
// text into a <pre>, so literal **, |, and ### characters showed up
// verbatim instead of being rendered — this replaces that.
//
// Deliberately a small hand-written parser (same approach as
// motion-markdown.tsx) rather than pulling in a markdown dependency: the
// model only emits this fixed vocabulary, and it keeps the render path
// dependency-free.

type ChatBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "ordered-item"; index: number; text: string }
  | { type: "bullet-item"; text: string }
  | { type: "paragraph"; text: string };

type InlineRun = { text: string; bold?: boolean; italic?: boolean };

function parseInline(raw: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const boldSplit = raw.split(/(\*\*[^*]+\*\*)/g);
  for (const chunk of boldSplit) {
    if (!chunk) continue;
    const boldMatch = chunk.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      runs.push({ text: boldMatch[1], bold: true });
      continue;
    }
    const italicSplit = chunk.split(/(\*[^*]+\*)/g);
    for (const sub of italicSplit) {
      if (!sub) continue;
      const italicMatch = sub.match(/^\*([^*]+)\*$/);
      if (italicMatch) runs.push({ text: italicMatch[1], italic: true });
      else runs.push({ text: sub });
    }
  }
  return runs;
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|") && line.includes("|", 1);
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function parseChatMarkdown(md: string): ChatBlock[] {
  const lines = (md ?? "").replace(/\r\n/g, "\n").split("\n");
  const blocks: ChatBlock[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").trim();
      if (text) blocks.push({ type: "paragraph", text });
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (line === "") {
      flushPara();
      i++;
      continue;
    }

    // Table: a row line immediately followed by a separator row.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^###\s+/.test(line)) {
      flushPara();
      blocks.push({ type: "h3", text: line.replace(/^###\s+/, "") });
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushPara();
      blocks.push({ type: "h2", text: line.replace(/^##\s+/, "") });
      i++;
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushPara();
      blocks.push({ type: "h1", text: line.replace(/^#\s+/, "") });
      i++;
      continue;
    }

    const ordered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      flushPara();
      blocks.push({ type: "ordered-item", index: Number(ordered[1]), text: ordered[2] });
      i++;
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushPara();
      blocks.push({ type: "bullet-item", text: bullet[1] });
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

function InlineText({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {r.text}
          </strong>
        ) : r.italic ? (
          <em key={i}>{r.text}</em>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

function ChatTable({ header, rows }: { header: string[]; rows: string[][] }) {
  return (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="bg-secondary/70">
            {header.map((h, i) => (
              <th key={i} className="border-b border-border px-2.5 py-1.5 font-semibold text-foreground">
                <InlineText runs={parseInline(h)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? "bg-secondary/20" : undefined}>
              {row.map((cell, ci) => (
                <td key={ci} className="border-b border-border/60 px-2.5 py-1.5 align-top text-foreground/90">
                  <InlineText runs={parseInline(cell)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders chat/assistant markdown (headings, bold, tables, lists) instead of dumping raw text. */
export function ChatMarkdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = parseChatMarkdown(text);
  const nodes: React.ReactNode[] = [];

  let orderedBuf: { index: number; text: string }[] = [];
  let bulletBuf: string[] = [];
  const flushOrdered = (key: string) => {
    if (orderedBuf.length) {
      nodes.push(
        <ol key={key} className="my-1.5 list-none space-y-1 pl-0">
          {orderedBuf.map((it) => (
            <li key={it.index} className="flex gap-2 leading-relaxed">
              <span className="shrink-0 tabular-nums text-foreground/60">{it.index}.</span>
              <span>
                <InlineText runs={parseInline(it.text)} />
              </span>
            </li>
          ))}
        </ol>,
      );
      orderedBuf = [];
    }
  };
  const flushBullets = (key: string) => {
    if (bulletBuf.length) {
      nodes.push(
        <ul key={key} className="my-1.5 list-disc space-y-1 pl-5 marker:text-primary">
          {bulletBuf.map((t, i) => (
            <li key={i} className="leading-relaxed">
              <InlineText runs={parseInline(t)} />
            </li>
          ))}
        </ul>,
      );
      bulletBuf = [];
    }
  };

  blocks.forEach((b, i) => {
    if (b.type === "ordered-item") {
      flushBullets(`ul-${i}`);
      orderedBuf.push({ index: b.index, text: b.text });
      return;
    }
    if (b.type === "bullet-item") {
      flushOrdered(`ol-${i}`);
      bulletBuf.push(b.text);
      return;
    }
    flushOrdered(`ol-${i}`);
    flushBullets(`ul-${i}`);

    if (b.type === "table") {
      nodes.push(<ChatTable key={i} header={b.header} rows={b.rows} />);
    } else if (b.type === "h1") {
      nodes.push(
        <h3 key={i} className="mt-3 mb-1 text-[14px] font-bold text-foreground first:mt-0">
          {b.text}
        </h3>,
      );
    } else if (b.type === "h2") {
      nodes.push(
        <h4 key={i} className="mt-2.5 mb-1 text-[13px] font-bold text-foreground first:mt-0">
          {b.text}
        </h4>,
      );
    } else if (b.type === "h3") {
      nodes.push(
        <h5 key={i} className="mt-2 mb-1 text-[12.5px] font-semibold text-foreground/90 first:mt-0">
          {b.text}
        </h5>,
      );
    } else {
      nodes.push(
        <p key={i} className="my-1.5 leading-relaxed first:mt-0">
          <InlineText runs={parseInline(b.text)} />
        </p>,
      );
    }
  });
  flushOrdered("ol-end");
  flushBullets("ul-end");

  return <div className={`text-sm ${className}`}>{nodes}</div>;
}
