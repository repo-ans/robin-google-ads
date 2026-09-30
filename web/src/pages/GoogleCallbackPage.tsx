import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { actions } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { GOOGLE_STATE_KEY, googleRedirectUri } from "../lib/googleOauth";
import AppHeader from "../components/AppHeader";
import { Card, Notice } from "../components/ui";

type Arrival = { code: string | null; problem: string | null };

// Read once on arrival: take the code, clear it from the address bar, and check
// the state against the one saved before leaving for Google.
function readArrival(): Arrival {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  window.history.replaceState(null, "", window.location.pathname);

  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(GOOGLE_STATE_KEY);
    sessionStorage.removeItem(GOOGLE_STATE_KEY);
  } catch {
    expected = null;
  }
  if (error) return { code: null, problem: error === "access_denied" ? "Access was not allowed on the Google page." : `Google said: ${error}` };
  if (!code || !state || !expected || state !== expected) {
    return { code: null, problem: "This sign-in did not start from the Settings page, so it was not used. Try Connect with Google again." };
  }
  return { code, problem: null };
}

// Google sends Rob back here after "Connect with Google". The sign-in code goes
// to n8n, which swaps it for a refresh token and stores it. The code is never
// stored in the browser.
export default function GoogleCallbackPage() {
  const [arrival] = useState(readArrival);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(arrival.problem ? { ok: false, text: arrival.problem } : null);
  const sent = useRef(false);

  useEffect(() => {
    if (!arrival.code || sent.current) return; // strict mode runs effects twice in development
    sent.current = true;
    actions
      .googleAdsSettings({ action: "exchange_code", code: arrival.code, redirect_uri: googleRedirectUri() })
      .then((r) => setResult({ ok: true, text: r.message ?? "Connected." }))
      .catch((e) => setResult({ ok: false, text: e instanceof N8nError ? e.message : "Could not finish connecting." }));
  }, [arrival]);

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <AppHeader title="Connect with Google" back={{ to: "/settings", label: "Settings" }} />
        <Card className="mt-8 p-6">
          {!result && <p className="text-sm text-ink-subtle">Finishing the connection...</p>}
          {result?.ok && <p className="text-sm text-success">{result.text} Run Test connection on the Settings page to check everything.</p>}
          {result && !result.ok && <Notice>{result.text}</Notice>}
          <Link to="/settings" className="mt-4 inline-block text-sm font-semibold hover:underline">Back to Settings</Link>
        </Card>
      </div>
    </main>
  );
}
