// Regression tests for Phase 1 item #2 of the "Universal Completed Case
// Legal Audit Architecture Fix": a code-level invariant so a party's
// ARGUMENT can never be persisted as if it were a court's HOLDING merely
// because an upstream engine mispaired proposition_type/speaker_role.
import { describe, it, expect } from "vitest";
import {
  validateFindingClassification,
  validateFindingCategory,
} from "../finding-classification-gate";
import type { NewFinding } from "../types";

const f = (o: Partial<NewFinding>): NewFinding =>
  ({
    case_id: "case-1",
    user_id: "user-1",
    source_module: "agent:x",
    category: "x",
    title: "t",
    description: "d",
    severity: "medium",
    confidence: 0.5,
    legal_significance: null,
    potential_impact: null,
    affected_party: null,
    ...o,
  }) as NewFinding;

describe("validateFindingClassification", () => {
  it("downgrades a holding attributed to a party (quejoso) to an argument", () => {
    const { finding, downgrades } = validateFindingClassification(
      f({ proposition_type: "holding", speaker_role: "quejoso" }),
    );
    expect(finding.proposition_type).toBe("argument");
    expect(finding.speaker_role).toBe("quejoso"); // untouched — only the proposition_type is unsafe
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].field).toBe("proposition_type");
  });

  it("downgrades a rejected_holding attributed to autoridad to an argument", () => {
    const { finding, downgrades } = validateFindingClassification(
      f({ proposition_type: "rejected_holding", speaker_role: "autoridad" }),
    );
    expect(finding.proposition_type).toBe("argument");
    expect(downgrades).toHaveLength(1);
  });

  it("leaves a holding attributed to a court instance untouched", () => {
    for (const role of ["tribunal_colegiado", "tribunal_local", "scjn"] as const) {
      const { finding, downgrades } = validateFindingClassification(
        f({ proposition_type: "holding", speaker_role: role }),
      );
      expect(finding.proposition_type).toBe("holding");
      expect(downgrades).toHaveLength(0);
    }
  });

  it("leaves an argument attributed to a party untouched", () => {
    const { finding, downgrades } = validateFindingClassification(
      f({ proposition_type: "argument", speaker_role: "quejoso" }),
    );
    expect(finding.proposition_type).toBe("argument");
    expect(downgrades).toHaveLength(0);
  });

  it("passes through findings with no proposition_type/speaker_role set", () => {
    const { finding, downgrades } = validateFindingClassification(f({}));
    expect(finding.proposition_type).toBeUndefined();
    expect(downgrades).toHaveLength(0);
  });

  it("passes through a holding with no speaker_role (nothing to contradict)", () => {
    const { finding, downgrades } = validateFindingClassification(
      f({ proposition_type: "holding" }),
    );
    expect(finding.proposition_type).toBe("holding");
    expect(downgrades).toHaveLength(0);
  });
});

describe("validateFindingCategory", () => {
  it("passes through a category that is part of the materia's allowed vocabulary", () => {
    const { finding, downgrades } = validateFindingCategory(
      f({ category: "cadena_de_custodia" }),
      "penal",
      "general_finding",
    );
    expect(finding.category).toBe("cadena_de_custodia");
    expect(downgrades).toHaveLength(0);
  });

  it("passes through a universal structural category regardless of materia", () => {
    const { finding, downgrades } = validateFindingCategory(
      f({ category: "contradiction" }),
      "laboral",
      "general_finding",
    );
    expect(finding.category).toBe("contradiction");
    expect(downgrades).toHaveLength(0);
  });

  it("downgrades a category with no relationship to the case's materia", () => {
    const { finding, downgrades } = validateFindingCategory(
      f({ category: "totally_unrelated_made_up_label_xyz" }),
      "laboral",
      "general_finding",
    );
    expect(finding.category).toBe("general_finding");
    expect(downgrades).toHaveLength(1);
    expect(downgrades[0].field).toBe("category");
  });

  it("passes through findings with no category set", () => {
    const { finding, downgrades } = validateFindingCategory(
      f({ category: "" }),
      "laboral",
      "general_finding",
    );
    expect(finding.category).toBe("");
    expect(downgrades).toHaveLength(0);
  });
});
