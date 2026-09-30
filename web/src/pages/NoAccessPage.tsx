import { useAuth } from "../lib/auth";

// Signed in, but no active profile: FF turned the login off, or it was created
// without a profile row. RLS already returns nothing for these users.
export default function NoAccessPage({ reason }: { reason: "disabled" | "no-profile" }) {
  const { signOut } = useAuth();

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-4 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-bold">No access</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {reason === "disabled"
            ? "This login has been turned off. Contact Funeral Futurist if you think this is a mistake."
            : "This login is not set up for the dashboard yet. Contact Funeral Futurist to finish setting it up."}
        </p>
        <button
          onClick={() => signOut()}
          className="mt-6 w-full rounded-lg bg-accent px-5 py-3 font-semibold text-accent-ink hover:bg-accent-hover"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
