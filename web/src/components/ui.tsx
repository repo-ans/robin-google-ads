import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

// Shared building blocks in the reference style (slate, rounded cards,
// uppercase table headers), on the theme tokens so dark mode and print work.

type Variant = "primary" | "outline" | "subtle" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  outline: "border-2 border-accent text-ink hover:bg-accent hover:text-accent-ink",
  subtle: "border border-line-strong bg-surface text-ink hover:bg-surface-muted",
  danger: "border border-danger-line text-danger hover:bg-danger-soft",
  ghost: "text-ink-subtle hover:text-ink",
};

export function Button({
  variant = "subtle",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type="button"
      {...rest}
      className={`no-print rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${VARIANTS[variant]} ${className}`}
    />
  );
}

// A link that looks like a small subtle button (no button nested in a link).
export const linkButtonClass =
  "no-print inline-block rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-muted";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card rounded-xl border border-line bg-surface ${className}`}>{children}</div>;
}

export function Section({ title, actions, children, hint }: { title: string; actions?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase text-ink-subtle">{label}</p>
      <p className="mt-1 text-lg font-bold leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p>}
    </div>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-muted text-ink-muted",
    good: "bg-surface-muted text-success",
    warn: "bg-warning-soft text-warning",
    bad: "bg-danger-soft text-danger",
    info: "bg-info-soft text-info",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function StatusPill({ status }: { status: string | null | undefined }) {
  const s = (status || "").toUpperCase();
  const tone = s === "ENABLED" || s === "OK" || s === "APPROVED" || s === "BUILT" ? "good"
    : s === "PAUSED" || s === "PARTIAL" || s === "DRAFT" || s === "BUILDING" ? "warn"
      : s === "REMOVED" || s === "FAILED" || s === "DISAPPROVED" || s === "ERROR" ? "bad" : "neutral";
  return <Pill tone={tone}>{status ? status.toLowerCase().replace(/_/g, " ") : "-"}</Pill>;
}

// Skeleton loaders: grey blocks in the shape of what is coming, instead of "Loading..." text.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-muted ${className}`} />;
}

export function SkeletonLines({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 py-2" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? "w-1/2" : i % 3 === 1 ? "w-5/6" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface" aria-hidden>
      <div className="flex gap-4 border-b border-line px-4 py-3">
        {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={`h-3 ${c === 0 ? "w-40" : "flex-1"}`} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b border-line px-4 py-4 last:border-0">
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={`h-4 ${c === 0 ? "w-40" : "flex-1"}`} />)}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-3 h-6 w-24" />
        </div>
      ))}
    </div>
  );
}

// A whole page while it (or its code) loads: title, cards, table.
export function PageSkeleton({ cards = false }: { cards?: boolean }) {
  return (
    <main className="min-h-screen bg-page px-4 py-8 sm:px-6 sm:py-10" role="status" aria-label="Loading">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Skeleton className="h-7 w-56" />
            <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="mt-8 flex justify-end"><Skeleton className="h-9 w-72 max-w-full" /></div>
        {cards && <div className="mt-6"><SkeletonCards /></div>}
        <div className="mt-6"><SkeletonTable /></div>
      </div>
    </main>
  );
}

export function Loading({ what = "Loading", rows }: { what?: string; rows?: number }) {
  return (
    <div className="py-4" role="status" aria-label={what}>
      <SkeletonTable rows={rows} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-sm text-ink-subtle">{children}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">{message}</div>;
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "info"; children: ReactNode }) {
  const cls = tone === "warn" ? "border-warning-line bg-warning-soft text-warning" : "border-line bg-info-soft text-info";
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; badge?: number | null }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" className="flex min-w-max gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => onChange(t.id)}
            className={
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition sm:px-4 " +
              (active === t.id ? "border-accent text-ink" : "border-transparent text-ink-subtle hover:text-ink")
            }
          >
            {t.label}
            {t.badge ? <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">{t.badge}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-2xl border border-line bg-surface p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-sm text-ink-subtle hover:text-ink" aria-label="Close">
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm text-ink-muted">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "Working..." : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>}
    </label>
  );
}

export function TestBadge() {
  if (import.meta.env.VITE_APP_ENV === "production") return null;
  return (
    <span className="no-print fixed bottom-3 left-3 z-40 rounded bg-warning px-2 py-1 text-xs font-bold text-page">
      TEST
    </span>
  );
}
