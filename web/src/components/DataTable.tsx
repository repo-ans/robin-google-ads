import { useMemo, useState, type ReactNode } from "react";
import { downloadCsv } from "../lib/csv";

export type Column<T> = {
  key: string;
  label: string;
  // Cell content. Defaults to the sort value.
  render?: (row: T) => ReactNode;
  // Used for sorting, filtering and CSV. Numbers sort numerically.
  value: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  // Leave out of the CSV (e.g. action buttons).
  noCsv?: boolean;
  // Hide on print (e.g. action buttons).
  noPrint?: boolean;
};

const PAGE_SIZES = [10, 25, 50, 100];

// Sortable, filterable, paginated table with CSV export (the CSV has every
// filtered row, not just the page). Scrolls sideways on phones; printing shows
// the current page. Filtering is a plain "contains" over the text columns.
export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  csvName,
  initialSort,
  searchPlaceholder = "Filter...",
  toolbar,
  empty = "Nothing here yet.",
  rowClassName,
  pageSize = 25,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  csvName?: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  empty?: ReactNode;
  rowClassName?: (row: T) => string;
  pageSize?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [query, setQuery] = useState("");
  const [size, setSize] = useState(pageSize);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = rows.filter((r) =>
        columns.some((c) => {
          const v = c.value(r);
          return typeof v === "string" && v.toLowerCase().includes(q);
        }),
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => {
          const va = col.value(a);
          const vb = col.value(b);
          if (va === vb) return 0;
          if (va === null || va === undefined || va === "") return 1;
          if (vb === null || vb === undefined || vb === "") return -1;
          return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
        });
      }
    }
    return out;
  }, [rows, columns, query, sort]);

  function toggleSort(key: string) {
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  // Clamp instead of resetting in an effect: new data or a narrower filter can
  // leave the old page number past the end.
  const current = Math.min(page, pageCount - 1);
  const start = current * size;
  const shown = filtered.slice(start, start + size);

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {rows.length > 5 && (
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
            aria-label="Filter rows"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none sm:w-64"
          />
        )}
        {toolbar}
        <span className="ml-auto text-xs text-ink-subtle">
          {filtered.length === rows.length ? `${rows.length} rows` : `${filtered.length} of ${rows.length} rows`}
        </span>
        {csvName && rows.length > 0 && (
          <button
            onClick={() =>
              downloadCsv(`${csvName}.csv`, columns.filter((c) => !c.noCsv).map((c) => ({ label: c.label, value: c.value })), filtered)
            }
            className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted"
          >
            Download CSV
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-sm text-ink-subtle">{empty}</p>
      ) : (
        <div className="card overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`whitespace-nowrap px-3 py-2.5 ${c.align === "right" ? "text-right" : ""} ${c.noPrint ? "no-print" : ""}`}
                    aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    {c.noCsv ? (
                      c.label
                    ) : (
                      <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
                        {c.label}
                        <span aria-hidden className="text-[10px]">
                          {sort?.key === c.key ? (sort.dir === "asc" ? "^" : "v") : ""}
                        </span>
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={rowKey(r)} className={`border-b border-line last:border-0 ${rowClassName ? rowClassName(r) : ""}`}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-3 py-2 align-top ${c.align === "right" ? "whitespace-nowrap text-right tabular-nums" : ""} ${c.noPrint ? "no-print" : ""}`}
                    >
                      {c.render ? c.render(r) : (c.value(r) ?? "-")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > PAGE_SIZES[0] && (
        <Pagination
          page={current}
          pageCount={pageCount}
          size={size}
          from={filtered.length ? start + 1 : 0}
          to={start + shown.length}
          total={filtered.length}
          onPage={setPage}
          onSize={(n) => {
            setSize(n);
            setPage(0);
          }}
        />
      )}
    </div>
  );
}

// Page numbers to show: first, last, and two either side of the current page.
function pageList(page: number, count: number): (number | "gap")[] {
  const keep = new Set([0, count - 1]);
  for (let i = page - 2; i <= page + 2; i++) if (i >= 0 && i < count) keep.add(i);
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

function Pagination({
  page, pageCount, size, from, to, total, onPage, onSize,
}: {
  page: number; pageCount: number; size: number; from: number; to: number; total: number;
  onPage: (p: number) => void; onSize: (n: number) => void;
}) {
  const btn = "min-w-8 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <nav className="no-print mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted" aria-label="Table pages">
      <span>Showing {from}-{to} of {total}</span>
      <label className="flex items-center gap-1.5">
        Rows per page
        <select
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
          className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
          <button className={btn} onClick={() => onPage(page - 1)} disabled={page === 0}>Prev</button>
          {pageList(page, pageCount).map((p, i) =>
            p === "gap" ? (
              <span key={`gap-${i}`} className="px-1">...</span>
            ) : (
              <button
                key={p}
                onClick={() => onPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={p === page ? "min-w-8 rounded-lg bg-accent px-2.5 py-1 text-xs font-semibold text-accent-ink" : btn}
              >
                {p + 1}
              </button>
            ),
          )}
          <button className={btn} onClick={() => onPage(page + 1)} disabled={page >= pageCount - 1}>Next</button>
        </div>
      )}
    </nav>
  );
}
