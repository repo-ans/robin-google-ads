// Reads a monthly case list (CSV) in the browser for the case match.
// The list never leaves the browser except in one POST to n8n (ff-case-match),
// which sends it to Google Ads and keeps only counts. Nothing is stored here
// either: the page drops the rows after each run.
//
// Allowed columns - no names of any kind:
//   case_date   YYYY-MM-DD, the day the case was signed (required)
//   case_type   e.g. at-need, preneed (optional; only counted)
//   value       case value in the account currency (optional; the client's case value is used if empty)
//   gclid, gbraid, wbraid   click ids from the GHL contact (optional)
//   email, phone            the family's contact email / phone (optional, hashed by n8n before upload)
//   call_time   YYYY-MM-DD HH:MM, when they first called (optional; with phone, matches calls from ads)

export const CASE_COLUMNS = ["case_date", "case_type", "phone", "email", "call_time", "value", "gclid", "gbraid", "wbraid"] as const;
export type CaseColumn = (typeof CASE_COLUMNS)[number];
export type CaseRow = Partial<Record<CaseColumn, string>>;

export type CaseListSummary = {
  rows: number;
  withClickId: number;
  withEmailOrPhone: number;
  withCallTime: number;
  months: string[];
};

// RFC 4180-ish parser: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");

export function readCaseList(text: string): { rows: CaseRow[]; summary: CaseListSummary } | { error: string } {
  const table = parseCsv(text);
  if (table.length < 2) return { error: "The file has only the column names. Add one row per signed case under them (the first row stays the column names), then choose the file again." };
  const headers = table[0].map(normHeader);
  const unknown = headers.filter((h) => h && !(CASE_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) {
    return {
      error: `The list has columns that are not allowed: ${unknown.slice(0, 5).join(", ")}. Keep only ${CASE_COLUMNS.join(", ")} - remove names and any other personal details.`,
    };
  }
  if (!headers.includes("case_date")) return { error: "The list needs a case_date column (YYYY-MM-DD)." };
  if (table.length - 1 > 2000) return { error: "At most 2000 cases in one file." };

  const rows: CaseRow[] = table.slice(1).map((cells) => {
    const r: CaseRow = {};
    headers.forEach((h, i) => {
      const v = (cells[i] ?? "").trim();
      if (h && v) r[h as CaseColumn] = v;
    });
    return r;
  });
  const months = [...new Set(rows.map((r) => (r.case_date ?? "").slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort();
  return {
    rows,
    summary: {
      rows: rows.length,
      withClickId: rows.filter((r) => r.gclid || r.gbraid || r.wbraid).length,
      withEmailOrPhone: rows.filter((r) => r.email || r.phone).length,
      withCallTime: rows.filter((r) => r.phone && r.call_time).length,
      months,
    },
  };
}

export function downloadCaseTemplate() {
  const blob = new Blob([`${CASE_COLUMNS.join(",")}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "case-list-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
