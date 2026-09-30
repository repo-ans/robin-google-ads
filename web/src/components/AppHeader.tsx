import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { isAgency } from "../lib/types";
import ThemeToggle from "./ThemeToggle";

export const outlineButton =
  "rounded-lg border-2 border-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent hover:text-accent-ink disabled:opacity-60";
export const primaryButton =
  "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60";

// Page header in the reference layout: title and subtitle on the left,
// actions on the right. Buttons a role cannot use are not rendered.
export default function AppHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const agency = isAgency(profile?.role);
  const [printedAt] = useState(() => new Date().toLocaleString());

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="no-print text-sm text-ink-subtle hover:underline">
            {"<-"} {back.label}
          </Link>
        )}
        <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
        <p className="print-only mt-1 text-xs text-ink-subtle">
          Printed {printedAt}
        </p>
      </div>
      <nav className="no-print flex flex-wrap items-center gap-2 sm:gap-3">
        <ThemeToggle />
        {agency && (
          <Link to="/settings" className={outlineButton}>
            Settings
          </Link>
        )}
        <Link to="/account" className={outlineButton}>
          Account
        </Link>
        <button
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
          className="rounded-lg border-2 border-line-strong px-4 py-2 text-sm font-semibold text-ink-subtle hover:border-danger-line hover:text-danger"
        >
          Logout
        </button>
        {actions}
      </nav>
    </header>
  );
}
