import { useState } from "react";
import { RANGE_PRESETS, type DateRange } from "../lib/dateRange";

// 7 / 30 / 90 days or a custom range. Prints as a line of text.
export default function DateRangePicker({ range }: { range: DateRange }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="no-print flex flex-wrap justify-end gap-1">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              setOpen(false);
              range.setPreset(p.key);
            }}
            className={
              "rounded-full px-3 py-1 text-xs font-medium transition " +
              (range.key === p.key ? "bg-accent text-accent-ink" : "bg-surface-muted text-ink-muted hover:text-ink")
            }
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => {
            setFrom(range.from);
            setTo(range.to);
            setOpen((o) => !o);
          }}
          className={
            "rounded-full px-3 py-1 text-xs font-medium transition " +
            (range.key === "custom" ? "bg-accent text-accent-ink" : "bg-surface-muted text-ink-muted hover:text-ink")
          }
        >
          Custom
        </button>
      </div>
      {open && (
        <form
          className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && from <= to) {
              range.setCustom(from, to);
              setOpen(false);
            }
          }}
        >
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From"
            className="rounded border border-line-strong bg-surface px-2 py-1 text-ink" />
          <span className="text-ink-subtle">to</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To"
            className="rounded border border-line-strong bg-surface px-2 py-1 text-ink" />
          <button type="submit" className="rounded bg-accent px-2 py-1 font-semibold text-accent-ink">Apply</button>
        </form>
      )}
      <p className="text-xs text-ink-subtle">
        {range.label === `${range.from} to ${range.to}` ? range.label : `${range.label} (${range.from} to ${range.to})`}
      </p>
    </div>
  );
}
