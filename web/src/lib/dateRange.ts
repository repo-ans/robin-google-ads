import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Date range lives in the URL (?range=30d or ?range=custom&from=..&to=..) so a
// printed or shared page shows the same period. Data is synced through
// yesterday, so presets end yesterday.
export type RangeKey = "7d" | "30d" | "90d" | "custom";
export const RANGE_PRESETS: { key: Exclude<RangeKey, "custom">; label: string; days: number }[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const validDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function useDateRange(defaultKey: Exclude<RangeKey, "custom"> = "30d") {
  const [params, setParams] = useSearchParams();
  // "Today" is fixed when the page opens, so the range does not shift while it is open.
  const [today] = useState(() => new Date());
  const raw = params.get("range");
  const key: RangeKey = raw === "7d" || raw === "30d" || raw === "90d" || raw === "custom" ? raw : defaultKey;

  const { from, to } = useMemo(() => {
    const yesterday = addDays(today, -1);
    if (key === "custom") {
      const f = validDate(params.get("from"));
      const t = validDate(params.get("to"));
      if (f && t && f <= t) return { from: f, to: t };
    }
    const preset = RANGE_PRESETS.find((p) => p.key === key) ?? RANGE_PRESETS[1];
    return { from: iso(addDays(yesterday, -(preset.days - 1))), to: iso(yesterday) };
  }, [key, params, today]);

  const setPreset = useCallback(
    (k: Exclude<RangeKey, "custom">) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set("range", k);
        next.delete("from");
        next.delete("to");
        return next;
      }, { replace: true }),
    [setParams],
  );

  const setCustom = useCallback(
    (f: string, t: string) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set("range", "custom");
        next.set("from", f);
        next.set("to", t);
        return next;
      }, { replace: true }),
    [setParams],
  );

  const label =
    key === "custom" ? `${from} to ${to}` : RANGE_PRESETS.find((p) => p.key === key)?.label ?? "";

  return { key, from, to, label, setPreset, setCustom };
}

export type DateRange = ReturnType<typeof useDateRange>;
