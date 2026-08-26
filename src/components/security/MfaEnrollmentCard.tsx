import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Loader2, Trash2, QrCode } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Factor = { id: string; friendlyName: string | null; status: string; createdAt: string };

type Enrollment = { factorId: string; qrSvg: string | null; secret: string | null };

/**
 * Optional TOTP multi-factor enrollment.
 *
 * MFA is NOT enforced anywhere: no route guard, no RLS AAL2 requirement, and
 * no admin/superadmin gate depends on it. This card only lets a user add,
 * verify and remove their own authenticator app.
 */
export function MfaEnrollmentCard() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) setError(listError.message);
    setFactors(
      (data?.all ?? []).map((f) => ({
        id: f.id,
        friendlyName: f.friendly_name ?? null,
        status: f.status,
        createdAt: f.created_at,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    });
    setBusy(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Could not start MFA enrollment.");
      return;
    }
    setEnrollment({
      factorId: data.id,
      qrSvg: data.totp?.qr_code ?? null,
      secret: data.totp?.secret ?? null,
    });
  }

  async function verifyEnrollment() {
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrollment.factorId });
    if (challenge.error || !challenge.data) {
      setBusy(false);
      setError(challenge.error?.message ?? "Could not create MFA challenge.");
      return;
    }
    const verified = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verified.error) {
      setError(verified.error.message);
      return;
    }
    setEnrollment(null);
    setCode("");
    setNotice("Authenticator verified. MFA is enabled on your account (still optional).");
    await refresh();
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId }).catch(() => null);
    setBusy(false);
    setEnrollment(null);
    setCode("");
    await refresh();
  }

  async function removeFactor(factorId: string) {
    setBusy(true);
    setError(null);
    // Re-authentication: Supabase requires an AAL2 session to unenroll a
    // verified factor, so we challenge the factor first.
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setBusy(false);
      setError(challenge.error.message);
      return;
    }
    const reauthCode = window.prompt(
      "Enter the current 6-digit code from your authenticator to remove this factor:",
    );
    if (!reauthCode) {
      setBusy(false);
      return;
    }
    const verified = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code: reauthCode.trim(),
    });
    if (verified.error) {
      setBusy(false);
      setError(verified.error.message);
      return;
    }
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (unenrollError) {
      setError(unenrollError.message);
      return;
    }
    setNotice("Authenticator removed.");
    await refresh();
  }

  const verifiedFactors = factors.filter((f) => f.status === "verified");

  return (
    <section className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">
          Two-factor authentication (optional)
        </h2>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
        Add an authenticator app (TOTP) for a second sign-in step. MFA is currently optional —
        nothing on the platform requires it, and no role is blocked without it.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading factors…
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {verifiedFactors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No authenticator enrolled.</p>
          ) : (
            verifiedFactors.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {f.friendlyName ?? "Authenticator"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Verified · added {new Date(f.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeFactor(f.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {enrollment ? (
        <div className="mt-4 space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
            <QrCode className="h-3.5 w-3.5" /> Scan this code with your authenticator app
          </div>
          {enrollment.qrSvg ? (
            <img
              src={enrollment.qrSvg}
              alt="MFA enrollment QR code"
              className="h-40 w-40 rounded bg-white p-2"
            />
          ) : null}
          {enrollment.secret ? (
            <p className="break-all text-[11px] text-muted-foreground">
              Manual setup key: <code className="text-foreground">{enrollment.secret}</code>
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={busy || code.trim().length < 6}
              onClick={() => void verifyEnrollment()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Verify
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void cancelEnrollment()}
              className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startEnrollment()}
          className="mt-4 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50"
        >
          {busy ? "Working…" : "Add authenticator app"}
        </button>
      )}

      {error ? <p className="mt-3 text-[12px] text-destructive">{error}</p> : null}
      {notice ? <p className="mt-3 text-[12px] text-emerald-400">{notice}</p> : null}
    </section>
  );
}
