import { describe, it, expect } from "vitest";
import { polishText } from "../prose-polish.server";

describe("prose-polish", () => {
  it("removes 'it is important to note' filler", () => {
    const out = polishText("It is important to note that the contract was signed on Feb 1.");
    expect(out.toLowerCase()).not.toContain("it is important to note");
    expect(out).toMatch(/^The contract/);
  });

  it("rewrites 'Evidence supports' to a varied attorney opener", () => {
    const out = polishText("Evidence supports the claim of nonpayment.", "seed-1");
    expect(out.toLowerCase()).not.toMatch(/^evidence supports/);
    expect(out).toMatch(/nonpayment/);
  });

  it("collapses repeated 3-word openers within a paragraph", () => {
    const out = polishText(
      "The record shows nonpayment. The record shows late delivery. The record shows breach.",
      "seed-2",
    );
    // At least one duplicate opener should be dropped.
    expect(out.match(/The record shows/g)?.length ?? 0).toBeLessThan(3);
  });

  it("is deterministic for the same seed", () => {
    const a = polishText("Evidence supports the claim.", "seed-x");
    const b = polishText("Evidence supports the claim.", "seed-x");
    expect(a).toBe(b);
  });

  it("normalizes double spaces and stray spaces before punctuation", () => {
    const out = polishText("The claim  succeeds .");
    expect(out).toBe("The claim succeeds.");
  });
});
