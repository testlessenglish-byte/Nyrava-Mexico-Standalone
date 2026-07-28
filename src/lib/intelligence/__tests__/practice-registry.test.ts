// Universal Practice Area Architecture — registry parity.
// Every Mexican materia must declare every core capability and a full set of
// registry entries, so adding a future materia is one registry edit.
import { describe, it, expect } from "vitest";
import { MX_CASE_TYPES } from "@/lib/jurisdiction/mexico-types";
import {
  CORE_CAPABILITIES,
  CORE_TABS,
  CORE_PARTY_ROLES,
  MX_DASHBOARD_MODULES,
  MX_LIFECYCLE_STATUSES,
  MX_PARTY_ROLES,
  MX_TASK_TEMPLATES,
  MX_AI_PERSONA,
  lifecycleStatusesFor,
  partyRolesFor,
  taskTemplatesFor,
  aiPersonaFor,
} from "@/lib/jurisdiction/mexico-modules";

describe("practice-area registry parity", () => {
  it("core capability and tab sets are non-empty and unique", () => {
    expect(CORE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(new Set(CORE_CAPABILITIES).size).toBe(CORE_CAPABILITIES.length);
    expect(new Set(CORE_TABS).size).toBe(CORE_TABS.length);
  });

  for (const t of MX_CASE_TYPES) {
    it(`${t} declares every registry dimension`, () => {
      expect(MX_DASHBOARD_MODULES[t], "dashboard modules").toBeDefined();
      expect(MX_LIFECYCLE_STATUSES[t], "lifecycle statuses").toBeDefined();
      expect(MX_PARTY_ROLES[t], "party roles").toBeDefined();
      expect(MX_TASK_TEMPLATES[t], "task templates").toBeDefined();
      expect(typeof MX_AI_PERSONA[t]).toBe("string");
      expect(aiPersonaFor(t).length).toBeGreaterThan(10);
    });

    it(`${t} exposes core party roles and usable helpers`, () => {
      const roles = partyRolesFor(t);
      for (const core of CORE_PARTY_ROLES) expect(roles).toContain(core);
      expect(new Set(roles).size).toBe(roles.length);
      expect(lifecycleStatusesFor(t).length).toBeGreaterThan(0);
      for (const task of taskTemplatesFor(t)) {
        expect(task.title.es.length).toBeGreaterThan(0);
        expect(task.title.en.length).toBeGreaterThan(0);
      }
    });
  }
});
