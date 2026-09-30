import { useTheme, type ThemePref } from "../lib/theme";

const OPTIONS: { id: ThemePref; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export default function ThemeToggle() {
  const { pref, setPref } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="no-print inline-flex rounded-lg border border-line-strong bg-surface p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={pref === o.id}
          onClick={() => setPref(o.id)}
          className={
            "rounded-md px-2.5 py-1 text-xs font-semibold transition " +
            (pref === o.id ? "bg-accent text-accent-ink" : "text-ink-subtle hover:text-ink")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
