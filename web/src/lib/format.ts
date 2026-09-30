// Display helpers. Money is stored as micros (1/1,000,000 of the account currency).

export const fromMicros = (micros: number | string | null | undefined) => Number(micros ?? 0) / 1e6;

const moneyFormatters = new Map<string, Intl.NumberFormat>();
export function money(amount: number | null | undefined, currency?: string | null) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "-";
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  let f = moneyFormatters.get(code);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 2 });
    moneyFormatters.set(code, f);
  }
  return f.format(amount);
}
export const moneyMicros = (micros: number | string | null | undefined, currency?: string | null) =>
  micros === null || micros === undefined ? "-" : money(fromMicros(micros), currency);

const intFormat = new Intl.NumberFormat("en-US");
export const int = (n: number | string | null | undefined) => (n === null || n === undefined ? "-" : intFormat.format(Math.round(Number(n))));
export const dec = (n: number | string | null | undefined, digits = 2) =>
  n === null || n === undefined ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
export const pct = (fraction: number | null | undefined, digits = 1) =>
  fraction === null || fraction === undefined || Number.isNaN(fraction) ? "-" : `${(fraction * 100).toFixed(digits)}%`;

export const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const ctr = (clicks: number, impressions: number) => ratio(clicks, impressions);
export const avgCpcMicros = (costMicros: number, clicks: number) => (clicks > 0 ? costMicros / clicks : null);
export const costPerConvMicros = (costMicros: number, conversions: number) => (conversions > 0 ? costMicros / conversions : null);

export const customerId = (id: string | null | undefined) =>
  id && id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id ?? "-";

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-";
export const dateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "-");

// Google enum -> readable words: "SEARCH_STANDARD" -> "Search standard"
export const enumLabel = (v: string | null | undefined) =>
  v ? v.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "-";
