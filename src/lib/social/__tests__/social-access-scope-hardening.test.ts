import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const lovableMigration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260826010357_99c4b5d1-fa9f-414d-a49b-6686c80f02d3.sql",
  ),
  "utf8",
);
const correction = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260826023000_social_access_scope_correction.sql",
  ),
  "utf8",
);
const verification = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "verification",
    "20260826023000_social_access_scope_correction_verify.sql",
  ),
  "utf8",
);

const serverOnlyRoutines = [
  "admin_factory_reset_case_data",
  "project_case_findings",
  "consume_usage",
  "increment_reports_generated",
  "claim_engine_run",
  "provision_organization_subscription_from_webhook",
] as const;

const internalRoutines = [
  "handle_new_user",
  "invite_social_organization_member",
  "create_social_case",
] as const;

describe("social access-scope correction", () => {
  it("detects and reverses the blanket authenticated function grant", () => {
    expect(lovableMigration).toContain(
      "grant execute on function %s to authenticated",
    );
    for (const routine of serverOnlyRoutines) {
      expect(correction).toContain(routine);
      expect(verification).toContain(routine);
    }
    expect(correction).toContain(
      "execute format('revoke all on function %s from authenticated'",
    );
    expect(correction).toContain(
      "execute format('grant execute on function %s to service_role'",
    );
    for (const routine of internalRoutines) {
      expect(correction).toContain(routine);
      expect(verification).toContain(routine);
    }
    expect(correction).toContain(
      "execute format('revoke all on function %s from service_role'",
    );
  });

  it("fails closed for unknown activity entity types", () => {
    expect(correction).toContain("else");
    expect(correction).toContain("return false;");
    expect(correction).not.toContain(
      "Org-level bookkeeping entities (memberships, invitations, counters)",
    );
  });

  it("resolves document-version events through the parent document", () => {
    expect(correction).toContain(
      "join public.social_documents d on d.id = dv.document_id",
    );
    expect(correction).toContain("dv.org_id = p_org");
    expect(correction).toContain("d.org_id = p_org");
    expect(correction).toContain("d.record_type");
  });

  it("prevents browser clients from fabricating arbitrary audit events", () => {
    expect(correction).toContain(
      "event_type = 'case_media_ai_access_changed'",
    );
    expect(correction).toContain(
      "d.id = social_activity_events.entity_id",
    );
    expect(correction).toContain(
      "d.social_case_id is not distinct from social_activity_events.social_case_id",
    );
  });

  it("ships executable post-migration privilege and policy verification", () => {
    expect(verification).toContain("has_function_privilege");
    expect(verification).toContain("pg_get_functiondef");
    expect(verification).toContain("from pg_policies");
    expect(verification).toContain(
      "not (d.social_case_id is distinct from social_document_access_events.social_case_id)",
    );
    expect(verification).toContain("rollback;");
  });
});

