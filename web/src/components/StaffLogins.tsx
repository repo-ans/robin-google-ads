import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions, type ProfileRow } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAsync } from "../lib/useAsync";
import { ROLE_LABELS } from "../lib/types";
import DataTable from "./DataTable";
import { Button, ErrorNote, Field, Loading, Pill, inputClass } from "./ui";

// FF staff logins. rob_admin only (ff-client-admin checks this again).
export default function StaffLogins({ selfId }: { selfId: string }) {
  const [form, setForm] = useState({ email: "", password: "", role: "ff_staff" });
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAsync(async () => {
    const { data: rows, error: e } = await supabase.from("profiles").select("user_id, email, role, client_id, disabled, created_at")
      .in("role", ["rob_admin", "ff_staff"]).order("email");
    if (e) throw new Error(e.message);
    return rows as ProfileRow[];
  }, []);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await actions.clientAdmin(body);
      setMessage(r.message ?? "Done.");
      reload();
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    act({ action: "create_staff_login", ...form }).then(() => setForm({ email: "", password: "", role: "ff_staff" }));
  }

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-4">
      {message && <p className="text-sm text-ink-muted">{message}</p>}
      <DataTable
        rows={data ?? []}
        rowKey={(u) => u.user_id}
        columns={[
          { key: "email", label: "Email", value: (u) => u.email, render: (u) => <span className="font-medium">{u.email}</span> },
          { key: "role", label: "Role", value: (u) => ROLE_LABELS[u.role] },
          { key: "status", label: "Status", value: (u) => (u.disabled ? "off" : "active"), render: (u) => (u.disabled ? <Pill tone="bad">off</Pill> : <Pill tone="good">active</Pill>) },
          {
            key: "actions", label: "", noCsv: true, noPrint: true, value: () => null,
            render: (u) => u.user_id !== selfId && (
              <Button size="sm" variant={u.disabled ? "subtle" : "danger"} disabled={busy}
                onClick={() => act({ action: u.disabled ? "enable_login" : "disable_login", user_id: u.user_id })}>
                {u.disabled ? "Turn on" : "Turn off"}
              </Button>
            ),
          },
        ]}
      />
      <form onSubmit={create} className="no-print grid max-w-3xl gap-3 sm:grid-cols-4">
        <Field label="Email"><input type="email" required className={inputClass} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
        <Field label="Temporary password"><input type="text" required minLength={10} autoComplete="new-password" className={inputClass} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} /></Field>
        <Field label="Role">
          <select className={inputClass} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            <option value="ff_staff">FF staff</option>
            <option value="rob_admin">FF admin (can apply Google Ads changes)</option>
          </select>
        </Field>
        <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy}>Create staff login</Button></div>
      </form>
    </div>
  );
}
