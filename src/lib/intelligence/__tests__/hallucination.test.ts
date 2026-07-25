// Hallucination regression — known failure prompts must never be classified
// as factual, and unsupported amplification phrases must downgrade to
// analysis / hypothesis. The defaults defend against "factual amplification".
import { describe, it, expect } from "vitest";
import { classifyClaim } from "@/lib/intelligence/claim-class";

type Case = {
  label: string;
  text: string;
  hintedClass?: Parameters<typeof classifyClaim>[1];
  // The class MUST be in this set; the test fails if it isn't.
  allowed: Array<ReturnType<typeof classifyClaim>>;
};

const CASES: Case[] = [
  {
    label: "Custody vs Sole Custody — analyst paraphrase, no evidence",
    text: "The petitioner appears to have sole custody based on the record.",
    allowed: ["analysis"],
  },
  {
    label: "Denied ownership vs Lied — speculative leap",
    text: "Because he denied ownership, it is possible that he lied.",
    allowed: ["hypothesis"],
  },
  {
    label: "Joint custody vs Contradiction",
    text: "The statement may indicate a contradiction with the joint-custody order.",
    allowed: ["hypothesis"],
  },
  {
    label: "Missing Bodycam → Constitutional Violation",
    text: "Additional footage may reveal a constitutional violation.",
    allowed: ["hypothesis"],
  },
  {
    label: "Recommendation — strategic guidance, not fact",
    text: "Counsel should file a motion to suppress the warrantless search.",
    allowed: ["strategy"],
  },
  {
    label: "Bare paraphrase never resolves to hypothesis without speculative cues",
    text: "The witness changed her account between proceedings on the record.",
    // analysis (default) or fact (record/observation cue); never hypothesis.
    allowed: ["analysis", "fact", "strategy"],
  },
];

describe("hallucination classifier defense", () => {
  for (const c of CASES) {
    it(c.label, () => {
      const cls = classifyClaim(c.text, c.hintedClass ?? null);
      expect(c.allowed).toContain(cls);
    });
  }

  it("never classifies an empty string as fact", () => {
    expect(classifyClaim("")).not.toBe("fact");
  });

  it("respects an upstream FACT hint only when caller passes it", () => {
    // Same speculative text → classifier must NOT promote to fact on its own.
    const speculative = "Additional records could clarify the timeline.";
    expect(classifyClaim(speculative)).not.toBe("fact");
    // But an evidence-locked hint from upstream is honored.
    expect(classifyClaim(speculative, "fact")).toBe("fact");
  });
});
