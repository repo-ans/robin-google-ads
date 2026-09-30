import { useState, type FormEvent } from "react";
import { actions, rpc } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAsync } from "../lib/useAsync";
import { dateTime } from "../lib/format";
import { GOOGLE_STATE_KEY, googleRedirectUri } from "../lib/googleOauth";
import { Button, Card, ErrorNote, Loading, Notice, inputClass } from "./ui";

type Status = { name: string; is_set: boolean; hint: string | null; updated_at: string | null; updated_by_email: string | null };

// Same fields and order as the reference Settings page.
const FIELDS: { name: string; label: string }[] = [
  { name: "developer_token", label: "Developer Token" },
  { name: "client_id", label: "OAuth Client ID" },
  { name: "client_secret", label: "OAuth Client Secret" },
  { name: "refresh_token", label: "OAuth Refresh Token" },
  { name: "mcc_id", label: "MCC Customer ID" },
];

// Google Ads API settings, in the reference layout. Unlike the reference, the
// saved values are never sent back to the browser: a saved field shows as
// "Saved" and only a safe hint. Type in a field to replace it; empty fields keep
// the saved value. "Show values" shows what you are typing. Rob edits; FF
// staff see the status and can test.
export default function GoogleAdsConnection({ isRob }: { isRob: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => rpc<Status>("google_ads_connection_status", {}), []);

  const status = (name: string) => data?.find((s) => s.name === name);
  const clientId = status("client_id")?.hint ?? null;
  const canConnect = Boolean(clientId && status("client_secret")?.is_set);
  const last = data?.filter((s) => s.updated_at).sort((a, b) => (a.updated_at! < b.updated_at! ? 1 : -1))[0];

  async function run(label: string, fn: () => Promise<{ ok?: boolean; message?: string }>) {
    setBusy(label);
    setMessage(null);
    try {
      const r = await fn();
      setMessage({ ok: r.ok !== false, text: r.message ?? "Done." });
      reload();
      return true;
    } catch (e) {
      setMessage({ ok: false, text: e instanceof N8nError ? e.message : "Something went wrong." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    if (!Object.keys(filled).length) {
      setMessage({ ok: false, text: "Type a new value in at least one field." });
      return;
    }
    if (await run("save", () => actions.googleAdsSettings({ action: "save", values: filled }))) setValues({});
  }

  function connect() {
    if (!clientId) return;
    const state = crypto.randomUUID();
    try {
      sessionStorage.setItem(GOOGLE_STATE_KEY, state);
    } catch {
      setMessage({ ok: false, text: "This browser blocks session storage, so Connect with Google cannot run here." });
      return;
    }
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/adwords",
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();
    window.location.assign(url.toString());
  }

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;

  return (
    <Card className="rounded-2xl p-6 shadow-sm sm:p-8">
      <form onSubmit={save} className="space-y-4">
        <label className="no-print flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          Show values
        </label>

        {FIELDS.map((f) => {
          const s = status(f.name);
          return (
            <div key={f.name}>
              <label htmlFor={`gads-${f.name}`} className="mb-1 block text-sm font-medium text-ink-muted">
                {f.label}
              </label>
              <input
                id={`gads-${f.name}`}
                type={show ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                disabled={!isRob}
                className={inputClass + " px-4 py-2.5 font-mono"}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                placeholder={s?.is_set ? `Saved${s.hint ? ` (${s.hint})` : ""} - type to replace` : "Not set"}
              />
            </div>
          );
        })}

        {isRob && (
          <button
            type="submit"
            disabled={busy === "save"}
            className="no-print w-full rounded-lg bg-accent px-5 py-3 font-semibold text-accent-ink transition hover:bg-accent-hover disabled:opacity-60"
          >
            {busy === "save" ? "Saving..." : "Save Settings"}
          </button>
        )}
      </form>

      <div className="no-print mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={!!busy} onClick={() => run("test", () => actions.googleAdsSettings({ action: "test" }))}>
          {busy === "test" ? "Testing..." : "Test connection"}
        </Button>
        {isRob && (
          <Button variant="outline" disabled={!canConnect || !!busy} onClick={connect} title={canConnect ? "" : "Save the Client ID and Client Secret first"}>
            Connect with Google (get refresh token)
          </Button>
        )}
        {last?.updated_at && (
          <span className="text-xs text-ink-subtle">
            Last changed {dateTime(last.updated_at)}{last.updated_by_email ? ` by ${last.updated_by_email}` : ""}
          </span>
        )}
      </div>
      {message && (
        <div className="mt-3">{message.ok ? <p className="text-sm text-success">{message.text}</p> : <Notice>{message.text}</Notice>}</div>
      )}
      {isRob && (
        <p className="mt-4 text-xs text-ink-subtle">
          Connect with Google needs <span className="font-mono">{googleRedirectUri()}</span> in the OAuth client's "Authorized
          redirect URIs" (Google Cloud, Web application client), and the consent screen set to "In production" - in
          Testing, Google expires the refresh token after 7 days.
        </p>
      )}
    </Card>
  );
}
