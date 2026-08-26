# Nyrava México — Security Incident Response Runbook

Internal document. Version 1.0 — 2026-08-26.

This runbook describes the process the Nyrava México team follows when a
security or personal-data incident is suspected. It documents **process**, not
capabilities we have not built. Where a capability does not yet exist, it is
labelled `NOT IMPLEMENTED`.

Every incident is recorded in the `public.security_incidents` register
(administrator-only; see migration `security_incidents`). The register is the
system of record for the steps below.

---

## 0. Roles

| Role | Responsibility |
| --- | --- |
| Incident Lead | Owns the incident end to end; only person who changes its status |
| Technical Responder | Investigation, containment, evidence preservation |
| Legal/Privacy Reviewer | Determines whether Mexican breach-notification duties apply |
| Communications | Customer and (if required) regulator communication |

On a small team one person may hold several roles, but the Incident Lead must
be named explicitly in the incident record.

---

## 1. Detection

Sources that can start an incident:

- Platform error/alert review and worker logs (`pipeline_trace`, `audit_logs`,
  `admin_audit_log`).
- Rejected-upload warnings (`[upload-rejected]` log lines).
- Content-Security-Policy **Report-Only** violation reports (discovery mode —
  the policy is not enforced).
- Supabase security linter and the Lovable security scan.
- Reports from customers or security researchers via the Contact page.
- Provider/vendor notification (hosting, database, AI providers).

Automated intrusion detection, SIEM aggregation and 24/7 paging are
`NOT IMPLEMENTED`.

**Action:** create a `security_incidents` row immediately with
`discovered_at`, `title`, a provisional `severity`, and `status = 'open'`.
Create the record even if the report later proves to be a false positive.

---

## 2. Triage

Within **4 hours** of detection, the Incident Lead answers:

1. Is this a real security event, a bug, or a false positive?
2. Is personal data or attorney case content potentially involved?
3. Is it ongoing or historical?
4. What systems are implicated (application, database, storage, AI providers,
   email, payments)?

Severity guidance:

| Severity | Definition |
| --- | --- |
| `critical` | Confirmed cross-tenant data access, credential compromise, or active exfiltration |
| `high` | Plausible exposure of personal data or case content; privilege escalation |
| `medium` | Security control failure with no evidence of exposure |
| `low` | Hardening gap, informational finding, unexploited weakness |

Record `severity`, `category`, `affected_systems`, and set
`status = 'triage'`.

---

## 3. Containment

Set `containment_status` as work proceeds (`not_started` → `in_progress` →
`complete`) and record what was done in `containment_notes`.

Available containment actions today:

- Block the affected account (`profiles.is_blocked`) — stops all authenticated
  server functions for that user.
- Revoke or rotate provider/API secrets through the platform secret store.
- Rotate the backend service keys.
- Disable the affected feature path via code deploy.
- Force sign-out by rotating auth signing keys (last resort; signs out
  everyone).

Automatic per-tenant isolation switches and IP-level blocking are
`NOT IMPLEMENTED`.

**Do not** delete logs, storage objects, or database rows during containment.

---

## 4. Evidence preservation

Before remediation changes anything:

1. Export relevant rows from `audit_logs`, `admin_audit_log`,
   `pipeline_trace`, and `agent_logs` for the affected window.
2. Capture worker/application logs.
3. Record the exact deployment commit in the incident notes.
4. Store exports in the incident file with a SHA-256 hash of each export.

Chain-of-custody tooling and immutable WORM log storage are
`NOT IMPLEMENTED`; preservation today is a manual, documented export.

---

## 5. Scope determination

Establish, with evidence:

- Time window of the exposure.
- Which tables, buckets, or endpoints were reachable.
- Whether row-level security was bypassed at any point.
- Whether attorney case content, client personal data, or sensitive personal
  data (health, biometric, legal-proceeding data) is involved.

Record findings in `investigation_notes` and set `investigation_status`.

---

## 6. Identification of affected users and data

- Enumerate affected `auth.users` ids and record the count in
  `potentially_affected_users` and the ids in
  `potentially_affected_user_ids`.
- Identify affected organizations where the incident is tenant-scoped.
- Classify the data categories involved (identification, contact, financial,
  legal-proceeding, sensitive).

If exact scope cannot be established, document the **maximum plausible**
scope and say so explicitly.

---

## 7. Credential and key containment

For any incident touching secrets:

1. Rotate the affected provider keys.
2. Rotate the backend service-role key.
3. Invalidate user-supplied AI keys for affected workspaces and require
   re-entry (keys are stored AES-256-GCM encrypted).
4. Review `user_ai_keys.last_used_at` for anomalous use.
5. Rotate webhook shared secrets (payments, background worker).

Record every rotation with a timestamp.

---

## 8. Recovery

- Deploy the fix behind review; never hot-patch production data by hand
  without a written record.
- Re-run the Supabase security linter and the dependency scan.
- Confirm tenant isolation with a cross-tenant read test (Subscriber A must
  not be able to read Subscriber B).
- Confirm critical user workflows (sign-in, upload, analysis, report,
  download) still function.
- Set `resolved_at` and `status = 'resolved'` only after verification.

Point-in-time database restore is provided by the managed database platform;
Nyrava has not performed a documented restore drill — treat restore timing as
unverified.

---

## 9. Notification assessment

The Legal/Privacy Reviewer decides whether notification is required and
records `notification_required`, `notification_status`, and
`notification_notes`.

Inputs to the decision:

- Was personal data actually or plausibly accessed by an unauthorized party?
- Does the affected data materially affect the data owner's property or moral
  rights?
- Are attorney-client confidential materials implicated (a professional-duty
  question independent of data-protection law)?
- Do contractual commitments (DPA, enterprise agreements) impose shorter
  notice periods?

---

## 10. Mexican personal-data breach considerations

Nyrava México processes personal data of Mexican data subjects and is subject
to Mexican federal personal-data protection law (LFPDPPP framework) as a
responsible party (*responsable*) or processor (*encargado*) depending on the
engagement.

Key points to apply, with counsel:

- **Prompt notification to data owners.** Security breaches that materially
  affect the property or moral rights of data owners must be reported to the
  affected owners without delay so they can take action to protect their
  interests.
- **Minimum content of the notice:** the nature of the incident, the personal
  data compromised, recommendations the data owner can take to protect their
  interests, the corrective actions taken immediately, and how to obtain more
  information.
- **Sensitive data raises the bar.** Health, biometric, ideological and
  legal-proceeding data are sensitive; incidents touching them are treated as
  at least `high` severity by default.
- **Processor duty.** When Nyrava acts as *encargado* for a law firm, the firm
  is notified first and controls notification to its own clients.
- **Documentation.** Preserve the incident record, the analysis of causes, and
  the corrective/preventive measures adopted — regulators may request them.
- **Language.** Notices to Mexican data subjects are issued in Spanish.

Nyrava has **not** retained an external breach-response firm, and no
regulator-facing notification has ever been filed. These statements must be
kept accurate.

---

## 11. Post-incident review

Within **10 business days** of resolution:

1. Written timeline: detection → containment → resolution.
2. Root cause (technical and process).
3. What detection should have caught it earlier.
4. Concrete follow-up items with owners and dates.
5. Update this runbook if the process itself failed.
6. Set `status = 'closed'` only after follow-up items are filed.

---

## Appendix — what is deliberately NOT claimed

- No 24/7 on-call rotation.
- No automated intrusion detection or SIEM.
- No third-party penetration test completed to date.
- No SOC 2 audit.
- No documented disaster-recovery restore drill.
- CSP is Report-Only; it does not block anything today.
- MFA is available for enrollment but not enforced for any role.
