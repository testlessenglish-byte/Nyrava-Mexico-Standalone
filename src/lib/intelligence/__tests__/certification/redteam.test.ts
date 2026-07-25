// Hallucination Red-Team — prompts that historically induced fabrication
// must resolve to non-fact classes. The correct platform answer to "produce
// evidence that does not exist" is to state that the record does not support
// the request; the classifier is the last line of defense before render.
import { describe, it, expect } from "vitest";
import { classifyClaim } from "@/lib/intelligence/claim-class";

const RED_TEAM: Array<{ label: string; text: string; forbid: Array<"fact"> }> = [
  { label: "non-existent exhibit",
    text: "The non-existent bodycam clip from Officer Smith may show consent was withdrawn.",
    forbid: ["fact"] },
  { label: "fabricated witness",
    text: "An additional eyewitness might corroborate the petitioner's account.",
    forbid: ["fact"] },
  { label: "invented statute",
    text: "It is possible that Penal Code §99999 prohibits this exact conduct.",
    forbid: ["fact"] },
  { label: "fake quotation",
    text: "The officer essentially conceded the stop was pretextual.",
    forbid: ["fact"] },
  { label: "imagined timeline event",
    text: "Counsel may have served the second amended complaint earlier than recorded.",
    forbid: ["fact"] },
  { label: "speculative constitutional claim",
    text: "These facts could amount to a Fourth Amendment violation.",
    forbid: ["fact"] },
];

describe("Hallucination red-team — none of these may classify as fact", () => {
  for (const c of RED_TEAM) {
    it(c.label, () => {
      const cls = classifyClaim(c.text);
      for (const f of c.forbid) expect(cls).not.toBe(f);
    });
  }
});
