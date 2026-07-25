// Parity regression — every canonical helper must produce stable counts.
// If a helper changes shape, this snapshot must change in the same commit
// (intentional forcing function).
import { describe, it, expect } from "vitest";
import {
  getCanonicalCounts,
  paritySignature,
  getEssState,
} from "@/lib/intelligence/canonical";
import { FIXTURES } from "./fixtures";

const EXPECTED: Record<string, string> = {
  "fam-01": "f6.c2.d2.m0.t8.w3.s1.p1.o3.mo2.e10.ci10.th1.co0.xe0.na0.esshigh.ss0.ms0",
  "crim-01": "f5.c3.d1.m0.t6.w4.s1.p1.o2.mo3.e12.ci12.th1.co0.xe0.na0.essmedium.ss0.ms0",
  "civ-01": "f4.c1.d2.m0.t5.w2.s1.p1.o2.mo1.e9.ci9.th1.co0.xe0.na0.essmedium.ss0.ms0",
  "juv-01": "f3.c1.d1.m0.t4.w2.s1.p1.o1.mo1.e5.ci5.th1.co0.xe0.na0.esslow.ss0.ms0",
  "prob-01": "f4.c1.d2.m0.t3.w1.s1.p1.o2.mo0.e7.ci7.th1.co0.xe0.na0.essmedium.ss0.ms0",
  "emp-01": "f5.c2.d1.m0.t7.w3.s1.p1.o4.mo2.e11.ci11.th1.co0.xe0.na0.esshigh.ss0.ms0",
  "adm-01": "f2.c0.d1.m0.t2.w1.s1.p1.o1.mo0.e4.ci4.th1.co0.xe0.na0.esslow.ss0.ms0",
  // mixed-01 = minimal ESS, motions suppressed from raw 5 → 0
  "mixed-01": "f3.c0.d2.m0.t2.w1.s0.p1.o1.mo0.e3.ci3.th1.co0.xe0.na0.essminimal.ss1.ms1",
};

describe("canonical parity", () => {
  for (const f of FIXTURES) {
    it(`${f.id} signature is stable and matches snapshot`, () => {
      const sig = paritySignature(f.report);
      expect(sig).toBe(EXPECTED[f.id]);
    });

    it(`${f.id} counts are internally consistent across consecutive reads`, () => {
      // Reading twice must yield byte-identical results — proves helpers are pure.
      const a = JSON.stringify(getCanonicalCounts(f.report));
      const b = JSON.stringify(getCanonicalCounts(f.report));
      expect(a).toBe(b);
    });

    it(`${f.id} ESS state matches signature suppression flags`, () => {
      const ess = getEssState(f.report);
      const sig = paritySignature(f.report);
      expect(sig).toContain(`ess${ess.level}`);
      expect(sig).toContain(`ss${ess.scoresSuppressed ? 1 : 0}`);
      expect(sig).toContain(`ms${ess.motionsSuppressed ? 1 : 0}`);
    });
  }
});
