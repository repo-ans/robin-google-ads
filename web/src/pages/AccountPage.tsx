import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import { ROLE_LABELS } from "../lib/types";
import AppHeader from "../components/AppHeader";

const MIN_PASSWORD = 10;
const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-ink focus:border-accent focus:outline-none";

export default function AccountPage() {
  const { profile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (password.length < MIN_PASSWORD || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError(`Use at least ${MIN_PASSWORD} characters, with letters and numbers.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("The two passwords do not match.");
      return;
    }

    // Changing your own password is an auth action, so it goes straight to
    // Supabase Auth (allowed by the data-flow rule).
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <AppHeader title="Account" back={{ to: "/", label: "Dashboard" }} />

        <section className="card mt-8 max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h2 className="font-semibold">Your login</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-subtle">Email</dt>
            <dd className="break-all">{profile?.email}</dd>
            <dt className="text-ink-subtle">Role</dt>
            <dd>{profile ? ROLE_LABELS[profile.role] : ""}</dd>
          </dl>
        </section>

        <form
          onSubmit={handleSubmit}
          className="no-print mt-6 max-w-lg space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        >
          <h2 className="font-semibold">Change password</h2>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink-muted">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-ink-muted">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          {success && <p className="text-sm text-success">Password updated.</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent px-5 py-3 font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
