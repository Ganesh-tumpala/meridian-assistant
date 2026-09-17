/**
 * The frame every page sits in: the top bar, the navigation and the page
 * heading. Keeping it in one place is what makes the separate pages feel like
 * one product rather than six unrelated screens.
 */

import Link from "next/link";

export const NAV_LINKS = [
  { href: "/", label: "Chat" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/runs", label: "Runs" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/tools", label: "Tools" },
  { href: "/handoffs", label: "Handoffs" },
  { href: "/data", label: "Messages" },
];

export function TopBar({ current }: { current: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            M
          </span>
          <span className="text-[15px] font-semibold text-slate-800">Meridian</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = link.href === current;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg px-2.5 py-1.5 text-sm font-medium text-white"
                    : "rounded-lg px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                }
                style={active ? { background: "var(--brand)" } : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function Page({
  current,
  title,
  subtitle,
  actions,
  children,
}: {
  current: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <TopBar current={current} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            {subtitle && <p className="pt-1 text-sm text-slate-600">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------
 *  Small pieces used on more than one page
 * ----------------------------------------------------------------------- */

export function Card({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      {title && <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>}
      {description && <p className="pt-1 text-sm text-slate-600">{description}</p>}
      <div className={title || description ? "pt-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="pt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="pt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const TONES: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-800 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
  brand: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES | string;
}) {
  const classes = TONES[tone] ?? TONES.neutral;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs ${classes}`}
    >
      {children}
    </span>
  );
}

/** Maps a verdict or status onto one of the badge tones. */
export function toneFor(value: string): string {
  if (["ok", "pass", "true", "answered"].includes(value)) return "good";
  if (["rewritten", "warn", "elevated"].includes(value)) return "warn";
  if (["blocked", "error", "failed", "false", "high"].includes(value)) return "bad";
  return "neutral";
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      <p className="mx-auto max-w-md pt-2 text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-700">
      {children}
    </code>
  );
}

/** Postgres gives back a timestamp. Show it in a way a person can read. */
export function formatTime(value: string | Date): string {
  const when = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(when.getTime())) return String(value);
  return when.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
