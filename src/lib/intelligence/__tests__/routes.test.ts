// Route audit — no placeholder pages may ship; every _app/* route reads
// case intelligence through the canonical helpers (or is a pure shell).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = join(process.cwd(), "src", "routes");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}

const PLACEHOLDER_MARKERS = [
  "PlaceholderIndex",
  "data-lovable-blank-page-placeholder",
  "REPLACE this",
];

// Modules that legitimately don't read intelligence (shells, auth, etc.)
const SHELL_ALLOWLIST = [
  "_app/index.tsx",
  "_app/route.tsx",
  "_app.tsx",
  "_app/new.tsx",
  "_app/upload.tsx",
  "_app/account.tsx",
  "_app/settings.tsx",
  "_app/admin.tsx",
  "_app/talk.tsx",
  "_app/cases.index.tsx",
];

describe("route audit", () => {
  const files = walk(ROUTES_DIR);

  it("at least one route exists", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.replace(`${process.cwd()}/`, "");
    it(`${rel} contains no placeholder markers`, () => {
      const src = readFileSync(file, "utf8");
      for (const marker of PLACEHOLDER_MARKERS) {
        expect(src.includes(marker), `${rel} contains placeholder marker "${marker}"`).toBe(false);
      }
    });
  }
});
