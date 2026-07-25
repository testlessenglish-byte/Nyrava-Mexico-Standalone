import { it, expect } from "vitest";
import { buildCaseTypeManifest } from "@/lib/intelligence/practice-areas";
it("dupes", () => {
  const m = buildCaseTypeManifest("general_civil");
  const dup = m.enabled_engines.filter((e, i) => m.enabled_engines.indexOf(e) !== i);
  console.log("dupes:", dup);
  expect(dup).toEqual([]);
});
