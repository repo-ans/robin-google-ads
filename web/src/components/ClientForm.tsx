import { useState, type FormEvent } from "react";
import { actions, type Client } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { Button, ErrorNote, Field, Modal, inputClass } from "./ui";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const listText = (v: string[] | undefined) => (v ?? []).join(", ");
const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Create or edit a client. Saved by n8n (ff-client-admin), never directly.
// No personal names belong here - business details only.
export default function ClientForm({ client, onClose, onSaved }: { client?: Client; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: client?.name ?? "",
    contact_name: client?.contact_name ?? "",
    contact_email: client?.contact_email ?? "",
    google_ads_customer_id: "",
    slug: client?.slug ?? "",
    website_url: client?.website_url ?? "",
    phone: client?.phone ?? "",
    towns: listText(client?.towns),
    process: client?.process ?? "funeral_home",
    currency_code: client?.currency_code ?? "USD",
    case_value: client?.case_value_micros ? String(client.case_value_micros / 1e6) : "",
    competitor_terms: listText(client?.competitor_terms),
    own_brand_terms: listText(client?.own_brand_terms),
    slack_channel: client?.slack_channel ?? "",
    ghl_location_id: client?.ghl_location_id ?? "",
    google_sheet_id: client?.google_sheet_id ?? "",
    dataforseo_location_code: String(client?.dataforseo_location_code ?? 2840),
    language_code: client?.language_code ?? "en",
    days: client?.office_hours?.days ?? DAYS.slice(0, 5),
    start_hour: String(client?.office_hours?.start_hour ?? 9),
    end_hour: String(client?.office_hours?.end_hour ?? 17),
  });
  const [error, setError] = useState<string | null>(null);
  const [ghl, setGhl] = useState<{ id: string; name: string; town: string | null }[] | null>(null);
  const [ghlBusy, setGhlBusy] = useState(false);
  const [ghlError, setGhlError] = useState<string | null>(null);

  // FF's GHL sub-accounts (agency key, via n8n). Preselects the one whose name matches the client.
  async function loadGhl() {
    setGhlBusy(true);
    setGhlError(null);
    try {
      const r = await actions.ghlLocations();
      setGhl(r.locations);
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const match = r.locations.find((l) => norm(l.name) === norm(f.name)) ?? r.locations.find((l) => f.name && norm(l.name).includes(norm(f.name)));
      if (!f.ghl_location_id && match) setF((x) => ({ ...x, ghl_location_id: match.id }));
    } catch (err) {
      setGhlError(err instanceof N8nError ? err.message : "Could not load the GHL sub-accounts.");
    } finally {
      setGhlBusy(false);
    }
  }
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fields = {
      name: f.name,
      contact_name: f.contact_name,
      contact_email: f.contact_email,
      ...(f.google_ads_customer_id.trim() ? { google_ads_customer_id: f.google_ads_customer_id.trim() } : {}),
      website_url: f.website_url,
      phone: f.phone,
      towns: toList(f.towns),
      ...(!client || f.process !== client.process ? { process: f.process } : {}),
      currency_code: f.currency_code,
      case_value: f.case_value === "" ? null : Number(f.case_value),
      competitor_terms: toList(f.competitor_terms),
      own_brand_terms: toList(f.own_brand_terms),
      slack_channel: f.slack_channel,
      ghl_location_id: f.ghl_location_id,
      google_sheet_id: f.google_sheet_id,
      dataforseo_location_code: Number(f.dataforseo_location_code),
      language_code: f.language_code,
      office_hours: { days: f.days, start_hour: Number(f.start_hour), end_hour: Number(f.end_hour) },
    };
    try {
      await actions.clientAdmin(client ? { action: "update_client", client_id: client.id, ...fields } : { action: "create_client", slug: f.slug, ...fields });
      onSaved();
    } catch (err) {
      setError(err instanceof N8nError ? err.message : "Could not save the client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={client ? `Edit ${client.name}` : "New client"} onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name"><input required className={inputClass} value={f.name} onChange={set("name")} /></Field>
        <Field label="Client's name" hint="The contact person at the funeral home.">
          <input className={inputClass} value={f.contact_name} onChange={set("contact_name")} />
        </Field>
        <Field label="Email" hint="Contact email. Dashboard logins are created separately (Client logins).">
          <input type="email" className={inputClass} value={f.contact_email} onChange={set("contact_email")} />
        </Field>
        <Field label={client ? "Add a Google Ads Account ID" : "Google Ads Account ID"} hint="10 digits, like 123-456-7890. Links the account to this client.">
          <input className={inputClass} value={f.google_ads_customer_id} onChange={set("google_ads_customer_id")} placeholder="123-456-7890" />
        </Field>
        {!client && (
          <Field label="Short name (slug)" hint="Lowercase and hyphens, used in audit file names. Left empty, it is made from the name.">
            <input className={inputClass} value={f.slug} onChange={set("slug")} placeholder="mccall-gardens" />
          </Field>
        )}
        <Field label="Website"><input className={inputClass} value={f.website_url} onChange={set("website_url")} placeholder="https://" /></Field>
        <Field label="Business phone"><input className={inputClass} value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Type">
          <select className={inputClass} value={f.process} onChange={set("process")}>
            <option value="funeral_home">Funeral home (calls and preplanning forms)</option>
            <option value="online_cremation">Online cremation (paid arrangements)</option>
          </select>
        </Field>
        <Field label="Towns served" hint="Comma separated. Also kept in search terms by the name filter.">
          <input className={inputClass} value={f.towns} onChange={set("towns")} />
        </Field>
        <Field label="Currency"><input className={inputClass} value={f.currency_code} onChange={set("currency_code")} maxLength={3} /></Field>
        <Field label="Average case value" hint="Used for value reporting.">
          <input className={inputClass} type="number" min="0" step="1" value={f.case_value} onChange={set("case_value")} />
        </Field>
        <Field label="Competitor names" hint="Comma separated. Added as negatives when Rob builds a campaign.">
          <input className={inputClass} value={f.competitor_terms} onChange={set("competitor_terms")} />
        </Field>
        <Field label="Own brand names" hint="Comma separated.">
          <input className={inputClass} value={f.own_brand_terms} onChange={set("own_brand_terms")} />
        </Field>
        <Field label="Office hours (campaign C)">
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={f.days.includes(d)}
                  onChange={(e) => setF((x) => ({ ...x, days: e.target.checked ? [...x.days, d] : x.days.filter((y) => y !== d) }))}
                />
                {d.slice(0, 3)}
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input className={inputClass + " w-20"} type="number" min="0" max="23" value={f.start_hour} onChange={set("start_hour")} aria-label="Start hour" />
            <span>to</span>
            <input className={inputClass + " w-20"} type="number" min="1" max="24" value={f.end_hour} onChange={set("end_hour")} aria-label="End hour" />
          </div>
        </Field>
        <Field label="Keyword research location" hint="DataForSEO location code: 2840 United States, 2124 Canada.">
          <input className={inputClass} type="number" value={f.dataforseo_location_code} onChange={set("dataforseo_location_code")} />
        </Field>
        <Field label="Language">
          <select className={inputClass} value={f.language_code} onChange={set("language_code")}>
            <option value="en">English</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
          </select>
        </Field>
        <Field label="Slack channel (optional)"><input className={inputClass} value={f.slack_channel} onChange={set("slack_channel")} placeholder="#client-name" /></Field>
        <Field label="GHL sub-account (optional)" hint="Used for the preplanning form fields and the weekly lead count. Pick it from GHL, or paste the location ID.">
          {ghl ? (
            <select className={inputClass} value={f.ghl_location_id} onChange={set("ghl_location_id")}>
              <option value="">No GHL sub-account</option>
              {f.ghl_location_id && !ghl.some((l) => l.id === f.ghl_location_id) && <option value={f.ghl_location_id}>{f.ghl_location_id} (not found in GHL)</option>}
              {ghl.map((l) => <option key={l.id} value={l.id}>{l.name}{l.town ? ` - ${l.town}` : ""}</option>)}
            </select>
          ) : (
            <div className="flex gap-2">
              <input className={inputClass} value={f.ghl_location_id} onChange={set("ghl_location_id")} placeholder="Location ID" />
              <Button onClick={loadGhl} disabled={ghlBusy}>{ghlBusy ? "Loading..." : "Pick from GHL"}</Button>
            </div>
          )}
          {ghlError && <p className="mt-1 text-xs text-danger">{ghlError}</p>}
        </Field>
        <Field label="Google Sheet (optional)" hint="Paste the Sheet link. The weekly report adds one row per week to its Weekly tab.">
          <input className={inputClass} value={f.google_sheet_id} onChange={set("google_sheet_id")} placeholder="https://docs.google.com/spreadsheets/d/..." />
        </Field>
        {error && <div className="sm:col-span-2"><ErrorNote message={error} /></div>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save client"}</Button>
        </div>
      </form>
    </Modal>
  );
}
