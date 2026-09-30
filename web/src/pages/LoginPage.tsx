import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/auth";
import ThemeToggle from "../components/ThemeToggle";

const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-ink focus:border-accent focus:outline-none";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);
    if (error) {
      // Supabase gives the same message for a wrong password and an unknown
      // email, which is what we want: it does not reveal which one it was.
      setError(error.message);
    }
    // On success the auth listener sets the session and the redirect above runs.
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm"
      >
        <h1 className="text-xl font-bold text-ink">Funeral Futurist</h1>
        <p className="mt-1 text-sm text-ink-muted">Sign in to the ads dashboard.</p>

        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink-muted">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent px-5 py-3 font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </div>
        <p className="mt-6 text-xs text-ink-subtle">
          Funeral Futurist sets up all logins. For access or a password reset, contact your FF
          account manager.
        </p>
      </form>
      <div className="mt-6">
        <ThemeToggle />
      </div>
    </main>
  );
}
