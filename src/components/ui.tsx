import Link from "next/link";
import type { ReactNode } from "react";
import { SubmitButton } from "./client";
import { DEFAULT_TZ, STATUS_PRESENTATION, ago, fmtDate, fmtDay, marketDay, presentStatus, toneGlyph, type Tone } from "@/lib/format";
export { DEFAULT_TZ, STATUS_PRESENTATION, ago, fmtDate, fmtDay, marketDay, presentStatus, type Tone };

/** Small, legible, mobile-first primitives. Server-safe; the few interactive bits live in client.tsx. */

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6 sm:pb-10">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Card({ title, children, className = "", footer, id }: { title?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode; id?: string }) {
  return (
    <section id={id} className={`rounded-xl border border-line bg-card p-4 shadow-sm ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2> : null}
      {children}
      {footer ? <div className="mt-3 border-t border-line pt-3">{footer}</div> : null}
    </section>
  );
}

const toneClass: Record<Tone, string> = {
  neutral: "bg-line/60 text-foreground",
  good: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ value, title }: { value: string; title?: string }) {
  const p = presentStatus(value);
  return (
    <Badge tone={p.tone} title={title ?? p.label}>
      <span aria-hidden="true">{p.glyph}</span>
      <span>{p.label}</span>
    </Badge>
  );
}

export function Button({ children, variant = "primary", type = "submit", href, name, value, formAction, small, disabled, ariaLabel }: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "submit" | "button";
  href?: string;
  name?: string;
  value?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  small?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const base = `inline-flex min-h-11 items-center justify-center rounded-lg font-medium transition active:scale-[.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${small ? "min-h-9 px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm sm:text-base"}`;
  const v = {
    primary: "bg-accent text-white hover:opacity-90",
    secondary: "border border-line bg-card text-foreground hover:bg-background",
    danger: "bg-danger text-white hover:opacity-90",
    ghost: "text-accent hover:underline",
  }[variant];
  if (href) return <Link href={href} aria-label={ariaLabel} className={`${base} ${v}`}>{children}</Link>;
  if (type === "submit" && !formAction) return <SubmitButton className={`${base} ${v}`} name={name} value={value} disabled={disabled} ariaLabel={ariaLabel}>{children}</SubmitButton>;
  return (
    <button type={type} name={name} value={value} formAction={formAction} disabled={disabled} aria-label={ariaLabel} className={`${base} ${v}`}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint, error, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null; htmlFor?: string }) {
  return (
    <label className="block" htmlFor={htmlFor}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass = "w-full min-h-11 rounded-lg border border-line bg-card px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-danger";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function KV({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
          <dd className="text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">{children}</p>;
}

export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[520px] text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2 font-medium sm:px-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-6 text-center text-muted sm:px-2">
                Nothing here yet.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-b border-line/70 align-top">
                {r.map((c, j) => (
                  <td key={j} className="px-4 py-2 sm:px-2">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <div data-flash={error ? "error" : "ok"} className={`rounded-lg px-3 py-2 text-sm ${error ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`} role={error ? "alert" : "status"} aria-live="polite">
      <span aria-hidden="true">{error ? "✕ " : "● "}</span>
      {error ?? ok}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm ${toneClass[tone]}`} role="status">
      <span aria-hidden="true" className="mr-1">{toneGlyph[tone]}</span>
      {title ? <strong className="mr-1">{title}</strong> : null}
      {children}
    </div>
  );
}

/** Plain-language state line: kind decides the treatment; text carries the consequence and who acts next (UX-04). */
export function StateLine({ kind, children }: { kind: "info" | "action_needed" | "blocked" | "unresolved_decision" | "provider_unavailable" | "failure"; children: ReactNode }) {
  const map = {
    info: { tone: "neutral" as Tone, label: "Info" },
    action_needed: { tone: "warn" as Tone, label: "Action needed" },
    blocked: { tone: "danger" as Tone, label: "Blocked" },
    unresolved_decision: { tone: "warn" as Tone, label: "Owner decision" },
    provider_unavailable: { tone: "info" as Tone, label: "Provider not available" },
    failure: { tone: "danger" as Tone, label: "Technical problem" },
  }[kind];
  return (
    <p className="flex items-start gap-2 text-sm">
      <Badge tone={map.tone}>
        <span aria-hidden="true">{toneGlyph[map.tone]}</span> {map.label}
      </Badge>
      <span>{children}</span>
    </p>
  );
}

