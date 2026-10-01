import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions, type ClientMessage, type MessageDraft } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAuth } from "../lib/auth";
import { isAgency } from "../lib/types";
import { dateTime, money } from "../lib/format";
import { Button, ErrorNote, SkeletonLines } from "./ui";

// Client Suggestions (reference MessageThread + client portal, now behind a
// real login). Clients post; FF sees the AI draft, edits it and sends it.
// A change proposed in a draft can be applied by Rob only.
export default function MessageThread({
  clientId,
  campaignRowId,
  customerId,
  campaignId,
  currency,
}: {
  clientId: string;
  campaignRowId?: string;
  customerId?: string;
  campaignId?: string;
  currency?: string | null;
}) {
  const { profile } = useAuth();
  const agency = isAgency(profile?.role);
  const isRob = profile?.role === "rob_admin";
  const [messages, setMessages] = useState<ClientMessage[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, MessageDraft>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    let q = supabase
      .from("client_messages")
      .select("id, client_id, customer_id, campaign_id, direction, body, status, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    if (customerId && campaignId) q = q.eq("customer_id", customerId).eq("campaign_id", campaignId);
    const { data, error: e } = await q;
    if (e) {
      setError(e.message);
      return;
    }
    setMessages((data ?? []) as ClientMessage[]);
    if (agency && data?.length) {
      const ids = data.filter((m) => m.direction === "inbound").map((m) => m.id);
      const { data: d } = await supabase.from("message_drafts").select("message_id, draft_body, proposed_action, action_status").in("message_id", ids);
      setDrafts(Object.fromEntries(((d ?? []) as MessageDraft[]).map((x) => [x.message_id, x])));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, customerId, campaignId]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof N8nError ? e.message : "Something went wrong.");
    }
    await load();
    setBusy(null);
  }

  return (
    <div className="card rounded-xl border border-line bg-surface">
      <div className="space-y-4 p-4">
        {messages === null && <SkeletonLines lines={4} />}
        {messages?.length === 0 && (
          <p className="text-sm text-ink-subtle">No suggestions yet. {agency ? "Clients can send ideas or requests here." : "Send us an idea or a request below."}</p>
        )}
        {messages?.map((m) => {
          const draft = drafts[m.id];
          const pending = m.direction === "inbound" && m.status !== "answered";
          return (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[90%]">
                <p className="mb-1 text-xs text-ink-subtle">
                  {m.direction === "inbound" ? "Client" : "Funeral Futurist"} - {dateTime(m.created_at)}
                </p>
                <div className={"whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm " + (m.direction === "outbound" ? "bg-accent text-accent-ink" : "bg-surface-muted")}>
                  {m.body}
                </div>
                {agency && pending && (
                  <div className="no-print mt-2 rounded-lg border border-line p-3">
                    <p className="text-xs font-semibold uppercase text-ink-subtle">Reply (AI draft - edit before sending)</p>
                    <textarea
                      rows={4}
                      value={edits[m.id] ?? draft?.draft_body ?? ""}
                      onChange={(e) => setEdits((x) => ({ ...x, [m.id]: e.target.value }))}
                      className="mt-2 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                      placeholder={draft ? "" : "No draft yet - write a reply."}
                    />
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" variant="primary" disabled={!!busy || !(edits[m.id] ?? draft?.draft_body ?? "").trim()}
                        onClick={() => run(`reply-${m.id}`, () => actions.sendReply(m.id, (edits[m.id] ?? draft?.draft_body ?? "").trim()))}>
                        {busy === `reply-${m.id}` ? "Sending..." : "Send reply"}
                      </Button>
                    </div>
                  </div>
                )}
                {agency && draft?.proposed_action && (
                  <div className="mt-2 rounded-lg border border-warning-line bg-warning-soft p-3 text-xs text-warning">
                    <p className="font-bold uppercase">
                      Requested:{" "}
                      {draft.proposed_action.action_type === "update_daily_budget"
                        ? `daily budget ${money(draft.proposed_action.daily_budget, currency ?? null)}`
                        : draft.proposed_action.action_type === "pause_campaign" ? "pause the campaign" : "resume the campaign"}
                    </p>
                    {draft.action_status === "proposed" && isRob && (
                      <Button size="sm" variant="primary" className="mt-2" disabled={!!busy}
                        onClick={() => run(`apply-${m.id}`, () => actions.applyAction("message", m.id))}>
                        Confirm & Apply
                      </Button>
                    )}
                    {draft.action_status === "proposed" && !isRob && <p className="mt-1">Waiting for Rob to confirm.</p>}
                    {draft.action_status === "applied" && <p className="mt-1 font-semibold">Applied in Google Ads.</p>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && <div className="px-4 pb-2"><ErrorNote message={error} /></div>}
      <form
        className="no-print border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const body = text.trim();
          if (!body) return;
          setText("");
          run("post", () => actions.postMessage({ client_id: clientId, body, campaign_row_id: campaignRowId ?? null }));
        }}
      >
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          placeholder={agency ? "Add a note on the client's behalf..." : "Your suggestion or request for this campaign..."}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-ink-subtle">Please do not include family or personal names.</p>
          <Button type="submit" variant="primary" disabled={!text.trim() || !!busy}>{busy === "post" ? "Sending..." : "Send"}</Button>
        </div>
      </form>
    </div>
  );
}
