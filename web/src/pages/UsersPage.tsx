import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { actions, type ProfileRow } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAsync } from "../lib/useAsync";
import { date } from "../lib/format";
import AppHeader from "../components/AppHeader";
import DataTable from "../components/DataTable";
import { Button, ConfirmDialog, ErrorNote, Field, Loading, Modal, Pill, Section, inputClass } from "../components/ui";

// Client logins: FF staff create them (email + temporary password), reset
// passwords and turn logins off or on. All through n8n (ff-client-admin ->
// Supabase Auth Admin API). A client login sees only this client, read only.
export default function UsersPage() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  const [form, setForm] = useState({ email: "", password: "" });
  const [resetFor, setResetFor] = useState<ProfileRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [toggle, setToggle] = useState<ProfileRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [client, users] = await Promise.all([
      supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
      supabase.from("profiles").select("user_id, email, role, client_id, disabled, created_at").eq("client_id", clientId).order("created_at"),
    ]);
    if (users.error) throw new Error(users.error.message);
    return { name: (client.data?.name as string) ?? "Client", users: users.data as ProfileRow[] };
  }, [clientId]);

  async function act(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await actions.clientAdmin(body);
      setMessage(r.message ?? "Done.");
      after?.();
      reload();
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    act({ action: "create_login", client_id: clientId, email: form.email, password: form.password }, () => setForm({ email: "", password: "" }));
  }

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <AppHeader title={`${data?.name ?? "Client"} - logins`} back={{ to: `/dashboard/clients/${clientId}`, label: data?.name ?? "Client" }}
          subtitle="Client logins see this client's analytics only, read only. They cannot change anything in Google Ads." />
        {message && <p className="mt-4 text-sm text-ink-muted">{message}</p>}
        {error && <div className="mt-6"><ErrorNote message={error} /></div>}
        {loading && !data && <Loading />}
        {data && (
          <div className="mt-8">
            <DataTable
              rows={data.users}
              rowKey={(u) => u.user_id}
              empty="No logins for this client yet."
              columns={[
                { key: "email", label: "Email", value: (u) => u.email, render: (u) => <span className="font-medium">{u.email}</span> },
                { key: "status", label: "Status", value: (u) => (u.disabled ? "off" : "active"), render: (u) => (u.disabled ? <Pill tone="bad">off</Pill> : <Pill tone="good">active</Pill>) },
                { key: "created", label: "Created", value: (u) => u.created_at, render: (u) => date(u.created_at) },
                {
                  key: "actions", label: "", noCsv: true, noPrint: true, value: () => null,
                  render: (u) => (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => { setResetFor(u); setNewPassword(""); }}>Reset password</Button>
                      <Button size="sm" variant={u.disabled ? "subtle" : "danger"} onClick={() => setToggle(u)}>{u.disabled ? "Turn on" : "Turn off"}</Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}

        <Section title="Create a login" hint="Send the email and temporary password to the client yourself; they can change the password under Account.">
          <form onSubmit={create} className="no-print grid max-w-2xl gap-3 sm:grid-cols-3">
            <Field label="Email"><input type="email" required className={inputClass} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Temporary password" hint="10+ characters, letters and numbers.">
              <input type="text" required minLength={10} autoComplete="new-password" className={inputClass} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating..." : "Create login"}</Button></div>
          </form>
        </Section>
      </div>

      {resetFor && (
        <Modal title={`New password for ${resetFor.email}`} onClose={() => setResetFor(null)}>
          <form onSubmit={(e) => { e.preventDefault(); act({ action: "reset_password", user_id: resetFor.user_id, password: newPassword }, () => setResetFor(null)); }}>
            <Field label="New temporary password" hint="10+ characters, letters and numbers.">
              <input type="text" required minLength={10} autoComplete="new-password" className={inputClass} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setResetFor(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={busy}>Set password</Button>
            </div>
          </form>
        </Modal>
      )}
      {toggle && (
        <ConfirmDialog
          title={toggle.disabled ? `Turn on ${toggle.email}?` : `Turn off ${toggle.email}?`}
          message={toggle.disabled ? "They can sign in again." : "They are signed out and cannot sign in until the login is turned on again."}
          confirmLabel={toggle.disabled ? "Turn on" : "Turn off"}
          danger={!toggle.disabled}
          busy={busy}
          onCancel={() => setToggle(null)}
          onConfirm={() => {
            const u = toggle;
            setToggle(null);
            act({ action: u.disabled ? "enable_login" : "disable_login", user_id: u.user_id });
          }}
        />
      )}
    </main>
  );
}
