import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions, type ChatMessage, type ProposedAction } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAuth } from "../lib/auth";
import { money } from "../lib/format";
import { Button, ConfirmDialog, ErrorNote, SkeletonLines } from "./ui";

function describe(a: ProposedAction, currency: string | null) {
  if (a.action_type === "update_daily_budget") return `Set daily budget to ${money(a.daily_budget, currency)}`;
  return a.action_type === "pause_campaign" ? "Pause this campaign" : "Resume this campaign";
}

// Campaign Assistant (reference CampaignChat). Reads messages from Supabase;
// sending, resetting, deleting and dismissing go through n8n (ff-campaign-chat).
// Confirm & Apply is shown to rob_admin only and goes to ff-apply-campaign-action.
export default function CampaignChat({
  campaignRowId,
  customerId,
  campaignId,
  currency,
}: {
  campaignRowId: string;
  customerId: string;
  campaignId: string;
  currency: string | null;
}) {
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmApply, setConfirmApply] = useState<ChatMessage | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function load() {
    const { data, error: e } = await supabase
      .from("campaign_chat_messages")
      .select("id, role, content, proposed_action, action_status, is_proactive, created_at")
      .eq("customer_id", customerId)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: true });
    if (e) setError(e.message);
    else setMessages((data ?? []) as ChatMessage[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, campaignId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

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

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    run("send", () => actions.chat({ campaign_row_id: campaignRowId, action: "send", message: text }));
  };

  return (
    <div className="card rounded-xl border border-line bg-surface">
      <div className="no-print flex items-center justify-between border-b border-line px-4 py-2">
        <p className="text-xs text-ink-subtle">
          Ask about this campaign. Please do not type family or personal names - they are removed.
        </p>
        {messages && messages.length > 0 && (
          <button onClick={() => setConfirmReset(true)} className="text-xs font-semibold text-ink-subtle hover:text-danger">
            Reset conversation
          </button>
        )}
      </div>

      <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4">
        {messages === null && <SkeletonLines lines={4} />}
        {messages?.length === 0 && <p className="text-sm text-ink-subtle">No messages yet. Ask something below.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`group flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={
                "relative max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm " +
                (m.role === "user" ? "bg-accent text-accent-ink" : "bg-surface-muted text-ink")
              }
            >
              {m.is_proactive && <p className="mb-1 text-[11px] font-semibold uppercase text-ink-subtle">Suggestion after sync</p>}
              {m.content}
              {m.proposed_action && (
                <div className="mt-3 rounded-lg border border-warning-line bg-warning-soft p-3 text-warning">
                  <p className="text-xs font-bold uppercase">Proposed: {describe(m.proposed_action, currency)}</p>
                  {m.proposed_action.reason && <p className="mt-1 text-xs">{m.proposed_action.reason}</p>}
                  {m.action_status === "proposed" && (
                    <div className="no-print mt-2 flex gap-2">
                      {isRob ? (
                        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => setConfirmApply(m)}>
                          Confirm & Apply
                        </Button>
                      ) : (
                        <span className="text-xs">Waiting for Rob to confirm.</span>
                      )}
                      <Button size="sm" disabled={!!busy}
                        onClick={() => run(`dismiss-${m.id}`, () => actions.chat({ campaign_row_id: campaignRowId, action: "dismiss_action", message_id: m.id }))}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {m.action_status === "applied" && <p className="mt-2 text-xs font-semibold">Applied in Google Ads.</p>}
                  {m.action_status === "dismissed" && <p className="mt-2 text-xs">Dismissed.</p>}
                </div>
              )}
              <button
                onClick={() => run(`delete-${m.id}`, () => actions.chat({ campaign_row_id: campaignRowId, action: "delete_message", message_id: m.id }))}
                className="no-print absolute -right-2 -top-2 hidden rounded-full border border-line bg-surface px-1.5 text-[10px] text-ink-subtle hover:text-danger group-hover:block"
                aria-label="Delete message"
              >
                x
              </button>
            </div>
          </div>
        ))}
        {busy === "send" && <p className="text-sm text-ink-subtle">The assistant is thinking...</p>}
        <div ref={bottom} />
      </div>

      {error && <div className="px-4 pb-2"><ErrorNote message={error} /></div>}

      <form
        className="no-print flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant about this campaign..."
          className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          maxLength={4000}
        />
        <Button type="submit" variant="primary" disabled={!input.trim() || !!busy}>Send</Button>
      </form>

      {confirmReset && (
        <ConfirmDialog
          title="Reset this conversation?"
          message="All messages for this campaign are deleted. Google Ads is not changed."
          confirmLabel="Reset"
          danger
          busy={busy === "reset"}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            run("reset", () => actions.chat({ campaign_row_id: campaignRowId, action: "reset" }));
          }}
        />
      )}
      {confirmApply?.proposed_action && (
        <ConfirmDialog
          title="Apply this change in Google Ads?"
          message={
            <>
              <p className="font-semibold text-ink">{describe(confirmApply.proposed_action, currency)}</p>
              <p className="mt-2">Google checks the change first (validate only), then it is applied and logged. Test accounts always; live accounts only when writes are turned on for the client.</p>
            </>
          }
          confirmLabel="Apply"
          busy={busy === "apply"}
          onCancel={() => setConfirmApply(null)}
          onConfirm={() => {
            const m = confirmApply;
            setConfirmApply(null);
            run("apply", () => actions.applyAction("chat", m.id));
          }}
        />
      )}
    </div>
  );
}
