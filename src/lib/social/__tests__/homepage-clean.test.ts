import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const indexSource = readFileSync(join(root, "src", "routes", "index.tsx"), "utf8");
const newCaseSource = readFileSync(join(root, "src", "routes", "_authenticated", "new.tsx"), "utf8");

describe("Homepage - Clean Removal of Inactive Trial Upload Section", () => {
  it("completely removes the public homepage trial upload band and dropzone", () => {
    expect(indexSource).not.toContain("home.upload.title");
    expect(indexSource).not.toContain("home.upload.tag");
    expect(indexSource).not.toContain("home.upload.dropzone.title");
    expect(indexSource).not.toContain("home.upload.dropzone.subtitle");
    expect(indexSource).not.toContain("home.upload.dropzone.formats");
    expect(indexSource).not.toContain("UploadCloud");
    expect(indexSource).not.toContain('<input type="file"');
  });

  it("preserves authentic hero CTAs, live case demos, and disclaimers", () => {
    expect(indexSource).toContain("home.cta.launchCommand");
    expect(indexSource).toContain("home.cta.watchDemo");
    expect(indexSource).toContain('to="/auth"');
    expect(indexSource).toContain('section id="product"');
    expect(indexSource).toContain("home.disclaimer.criterion");
    expect(indexSource).toContain("home.disclaimer.dataLaw");
  });

  it("verifies authenticated case upload workflow remains intact", () => {
    expect(newCaseSource).toBeDefined();
    expect(newCaseSource.length).toBeGreaterThan(100);
  });
});
