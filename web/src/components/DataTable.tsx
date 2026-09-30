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

// Sortable, filterable table with CSV export. Scrolls sideways on phones,
// prints in full. Filtering is a plain "contains" over the text columns.
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
  pageSize = 100,
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
  const [limit, setLimit] = useState(pageSize);

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
  }

  const shown = filtered.slice(0, limit);

  return (
    <div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        {rows.length > 5 && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
      {filtered.length > limit && (
        <div className="no-print mt-3 text-center">
          <button onClick={() => setLimit((l) => l + pageSize)} className="text-sm font-semibold text-ink-muted hover:text-ink">
            Show {Math.min(pageSize, filtered.length - limit)} more
          </button>
        </div>
      )}
    </div>
  );
}
