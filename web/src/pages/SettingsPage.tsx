import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { callN8n, N8nError } from "../lib/n8n";
import { actions } from "../lib/api";
import { useAuth } from "../lib/auth";
import StaffLogins from "../components/StaffLogins";
import { Button, Section } from "../components/ui";
import AppHeader, { outlineButton } from "../components/AppHeader";
import ErrorBox from "../components/ErrorBox";

type WhoAmI = { user_id: string; email: string; role: string; client_id: string | null };
type SyncRun = {
  id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  accounts_ok: number;
  accounts_failed: number;
  mutate_calls: number;
};
type RunAccount = {
  customer_id: string;
  status: string;
  error: string | null;
  resources: Record<string, { rows: number; error: string | null }>;
};

const TRIGGER_LABELS: Record<string, string> = {
  schedule: "Daily",
  schedule_weekly: "Weekly",
  manual: "Sync now",
};

const STATUS_CLASS: Record<string, string> = {
  ok: "text-success",
  partial: "text-warning",
  failed: "text-danger",
  running: "text-ink-subtle",
};

function formatId(id: string) {
  return id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

// Agency-only. No secrets are ever shown or edited here (the reference's
// Settings page edited Google Ads credentials in the browser; FF keeps them in
// Supabase private.secrets, readable only by n8n).
export default function SettingsPage() {
  const { profile } = useAuth();
  const [kwMessage, setKwMessage] = useState<string | null>(null);
  const [whoami, setWhoami] = useState<WhoAmI | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [runs, setRuns] = useState<SyncRun[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [runAccounts, setRunAccounts] = useState<RunAccount[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const { data, error } = await supabase
      .from("sync_runs")
      .select("id, trigger, started_at, finished_at, status, accounts_ok, accounts_failed, mutate_calls")
      .order("started_at", { ascending: false })
      .limit(15);
    if (error) {
      setRunsError(error.message);
      return;
    }
    setRuns(data);
  }, []);

  useEffect(() => {
    // Fetching on mount is what this effect is for.
    // oxlint-disable-next-line react/set-state-in-effect
    loadRuns();
  }, [loadRuns]);

  // While a run is in progress, refresh the list every 10 seconds.
  const running = runs?.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(loadRuns, 10000);
    return () => clearInterval(t);
  }, [running, loadRuns]);

  async function toggleRun(id: string) {
    if (openRun === id) {
      setOpenRun(null);
      return;
    }
    setOpenRun(id);
    setRunAccounts(null);
    const { data } = await supabase
      .from("sync_run_accounts")
      .select("customer_id, status, error, resources")
      .eq("sync_run_id", id)
      .order("customer_id");
    setRunAccounts(data ?? []);
  }

  async function syncNow() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await callN8n("ff/sync-now");
      setSyncMessage("Sync started. This list updates as it runs.");
      setTimeout(loadRuns, 2000);
    } catch (e) {
      setSyncMessage(e instanceof N8nError ? e.message : "Could not start the sync.");
    } finally {
      setSyncing(false);
    }
  }

  async function checkConnection() {
    setChecking(true);
    setCheckError(null);
    setWhoami(null);
    try {
      setWhoami(await callN8n<WhoAmI>("ff/whoami"));
    } catch (e) {
      setCheckError(e instanceof N8nError ? e.message : "The check failed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <AppHeader
          title="Settings"
          back={{ to: "/dashboard", label: "Dashboard" }}
          actions={
            <button onClick={syncNow} disabled={syncing || running} className={outlineButton}>
              {syncing ? "Starting..." : running ? "Syncing..." : "Sync now"}
            </button>
          }
        />
        {syncMessage && <p className="no-print mt-4 text-sm text-ink-muted">{syncMessage}</p>}

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Sync runs</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Daily at 06:00 (30 days), weekly on Sunday (90 days), and on demand. Read only - the sync never
            changes anything in Google Ads.
          </p>
          {runsError && <ErrorBox message={runsError} />}
          {runs === null && !runsError && <p className="mt-4 text-ink-subtle">Loading...</p>}
          {runs?.length === 0 && <p className="mt-4 text-ink-subtle">No sync has run yet.</p>}
          {runs && runs.length > 0 && (
            <div className="card mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-160 text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Accounts</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Google Ads changes</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const secs = r.finished_at
                      ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)
                      : null;
                    return (
                      <FragmentRow
                        key={r.id}
                        open={openRun === r.id}
                        onToggle={() => toggleRun(r.id)}
                        cells={[
                          new Date(r.started_at).toLocaleString(),
                          TRIGGER_LABELS[r.trigger] ?? r.trigger,
                          <span key="status" className={"font-semibold " + (STATUS_CLASS[r.status] ?? "")}>{r.status}</span>,
                          `${r.accounts_ok} ok${r.accounts_failed ? `, ${r.accounts_failed} failed` : ""}`,
                          secs === null ? "-" : secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs} s`,
                          String(r.mutate_calls),
                        ]}
                        detail={
                          runAccounts === null ? (
                            <p className="text-ink-subtle">Loading...</p>
                          ) : runAccounts.length === 0 ? (
                            <p className="text-ink-subtle">No accounts in this run.</p>
                          ) : (
                            <ul className="space-y-3">
                              {runAccounts.map((a) => {
                                const failed = Object.entries(a.resources ?? {}).filter(([, v]) => v.error);
                                const rows = Object.values(a.resources ?? {}).reduce((n, v) => n + (v.rows || 0), 0);
                                return (
                                  <li key={a.customer_id}>
                                    <span className="font-medium">{formatId(a.customer_id)}</span>{" "}
                                    <span className={STATUS_CLASS[a.status] ?? ""}>{a.status}</span>
                                    <span className="text-ink-subtle"> - {rows.toLocaleString()} rows</span>
                                    {failed.length > 0 && (
                                      <ul className="mt-1 space-y-0.5 pl-4 text-xs text-ink-muted">
                                        {failed.map(([name, v]) => (
                                          <li key={name} className="wrap-break-word">
                                            {name}: {v.error}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )
                        }
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Section title="Keyword research" hint="Search volume, CPC and related keywords from DataForSEO and Google Keyword Planner. Runs by itself every Monday.">
          <Button
            onClick={async () => {
              setKwMessage(null);
              try {
                await actions.keywordResearch();
                setKwMessage("Keyword research started for all clients.");
              } catch (e) {
                setKwMessage(e instanceof N8nError ? e.message : "Could not start keyword research.");
              }
            }}
          >
            Refresh keyword data now
          </Button>
          {kwMessage && <p className="mt-2 text-sm text-ink-muted">{kwMessage}</p>}
        </Section>

        {profile?.role === "rob_admin" && (
          <Section title="FF staff logins" hint="FF staff see every client and can manage client logins. Only FF admins can apply Google Ads changes.">
            <StaffLogins selfId={profile.user_id} />
          </Section>
        )}

        <section className="card no-print mt-10 max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h2 className="font-semibold">n8n connection</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Sends your login token to n8n, which checks it with Supabase and reads your role. Every dashboard
            action uses the same check.
          </p>
          <button onClick={checkConnection} disabled={checking} className={outlineButton + " mt-4"}>
            {checking ? "Checking..." : "Check connection"}
          </button>
          {checkError && <p className="mt-3 text-sm text-danger">{checkError}</p>}
          {whoami && (
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-ink-subtle">Signed in as</dt>
              <dd className="break-all">{whoami.email}</dd>
              <dt className="text-ink-subtle">Role seen by n8n</dt>
              <dd>{whoami.role}</dd>
            </dl>
          )}
        </section>
      </div>
    </main>
  );
}

function FragmentRow({
  cells,
  open,
  onToggle,
  detail,
}: {
  cells: React.ReactNode[];
  open: boolean;
  onToggle: () => void;
  detail: React.ReactNode;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-muted"
        aria-expanded={open}
      >
        {cells.map((c, i) => (
          <td key={i} className="px-4 py-3">
            {c}
          </td>
        ))}
      </tr>
      {open && (
        <tr className="border-b border-line bg-surface-muted">
          <td colSpan={cells.length} className="px-4 py-3 text-sm">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}
