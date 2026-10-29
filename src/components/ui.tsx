import Link from "next/link";
import type { ReactNode } from "react";
import { CopyableNumber, SubmitButton, Tabs } from "./client";
import { DEFAULT_TZ, STATUS_PRESENTATION, ago, fmtDate, fmtDay, marketDay, presentStatus, toneGlyph, type Tone } from "@/lib/format";
export { DEFAULT_TZ, STATUS_PRESENTATION, ago, fmtDate, fmtDay, marketDay, presentStatus, type Tone, Tabs };

/**
 * The primitives of the internal screens. One colour on one ground; hairline rules instead of boxes; Rubik
 * for everything, Merriweather (letterspaced) for display only; tabular figures in every table. Server-safe;
 * the few interactive bits live in client.tsx.
 */

/** Section label: Merriweather small caps, letterspaced. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2 ${className}`}>{children}</h2>;
}

/** Every page: title in Merriweather, one line of context, actions on the right, content below. */
export function Page({ title, subtitle, actions, children, wide = true }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full max-w-[1400px] px-4 pb-24 pt-4 sm:px-8 sm:pb-12 ${wide ? "" : "[&>*]:max-w-4xl"}`}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-rule pb-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-bold leading-tight text-ink sm:text-[26px]">{title}</h1>
          {subtitle ? <div className="mt-1 max-w-3xl text-[13px] leading-snug text-ink-2">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-5">{children}</div>
    </div>
  );
}

/**
 * A record page: the number set large in Merriweather and copyable, the status beside it, the actions on the
 * right, the record's own line of facts under the number. Details go in two columns, related items in tabs.
 */
export function RecordPage({ number, status, meta, actions, children }: { number: string; status?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-5 sm:px-8 sm:pb-12">
      <header className="mb-5 grid gap-x-8 gap-y-3 border-b border-rule pb-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="font-display text-[28px] font-bold leading-none text-ink sm:text-[32px]">
              <CopyableNumber value={number} />
            </h1>
            {status ? <div className="text-sm">{status}</div> : null}
          </div>
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex max-w-2xl flex-wrap items-center gap-2 lg:justify-end">{actions}</div> : null}
      </header>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

/** An action that needs a few fields: a button that opens a small panel under it; nothing on the page moves. */
export function ActionPanel({ label, children, variant = "secondary" }: { label: string; children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  const v = { primary: "bg-navy text-paper hover:opacity-90", secondary: "border border-rule bg-ground text-navy hover:border-navy", danger: "border border-ink text-ink hover:bg-paper" }[variant];
  return (
    <details className="relative">
      <summary className={`inline-flex h-9 cursor-pointer list-none items-center justify-center whitespace-nowrap px-4 text-sm font-medium ${v} [&::-webkit-details-marker]:hidden`}>{label}</summary>
      <div className="absolute right-0 z-10 mt-1 w-80 border border-rule bg-ground p-3 shadow-[0_1px_0_rgba(0,0,0,0.06)]">{children}</div>
    </details>
  );
}

/** Two columns of details on a record page. */
export function Columns({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">{children}</div>;
}

/** A section: a label above a hairline, content below. Keeps the old Card API so every page reads the same. */
export function Card({ title, children, className = "", footer, id }: { title?: ReactNode; children: ReactNode; className?: string; footer?: ReactNode; id?: string }) {
  return (
    <section id={id} className={className}>
      {title ? (
        <div className="mb-3 border-b border-rule pb-1.5">
          <SectionLabel>{title}</SectionLabel>
        </div>
      ) : null}
      {children}
      {footer ? <div className="mt-3 border-t border-rule-soft pt-3">{footer}</div> : null}
    </section>
  );
}

/**
 * Status and other labels are typography, not colour: navy at full weight for the good states (Delivered,
 * Issued, Verified), grey for everything else. Voided and cancelled stay grey; the number they belong to is
 * struck through where it is shown (see Struck).
 */
const toneText: Record<Tone, string> = {
  neutral: "text-ink-2",
  good: "font-semibold text-navy",
  warn: "text-ink-2",
  danger: "text-ink-2",
  info: "text-ink-2",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap text-[12px] ${toneText[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ value, title }: { value: string; title?: string }) {
  const p = presentStatus(value);
  return (
    <Badge tone={p.tone} title={title ?? p.label}>
      {p.label}
    </Badge>
  );
}

/** Voided or cancelled: the number with a line through it. */
export function Struck({ children, when = true }: { children: ReactNode; when?: boolean }) {
  return when ? <span className="line-through decoration-ink-3">{children}</span> : <>{children}</>;
}

/** Lot and SKU codes are set in the monospace face. */
export function Code({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[12.5px] ${className}`}>{children}</span>;
}

/** Quantities and money: right-aligned, tabular. */
export function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`block text-right tabular-nums ${className}`}>{children}</span>;
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
  const base = `inline-flex items-center justify-center whitespace-nowrap font-medium transition disabled:opacity-40 ${small ? "h-8 px-3 text-[13px]" : "h-9 px-4 text-sm"}`;
  const v = {
    primary: "bg-navy text-paper hover:opacity-90",
    secondary: "border border-rule bg-ground text-navy hover:border-navy",
    danger: "border border-ink text-ink hover:bg-paper",
    ghost: "px-1 text-navy hover:underline",
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
      <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-ink" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs leading-snug text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass = "w-full h-9 border border-rule bg-paper px-2.5 text-ink outline-none focus:border-navy aria-[invalid=true]:border-ink placeholder:text-ink-3";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} h-auto py-2 ${props.className ?? ""}`} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

/** Key and value pairs: label in small caps above the value, two columns. */
export function KV({ items, columns = 2 }: { items: Array<[string, ReactNode]>; columns?: 1 | 2 | 3 }) {
  const cols = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${cols}`}>
      {items.map(([k, v]) => (
        <div key={k} className="flex flex-col border-b border-rule-soft pb-1.5">
          <dt className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{k}</dt>
          <dd className="text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An empty state is one sentence. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-ink-2">{children}</p>;
}

export type Align = "left" | "right" | "center";

/**
 * The table is the primary surface: hairline rules, sticky header, row hover, tabular numerals, right-aligned
 * figures. `align` and `widths` are per column (figures right; number, type, date and status columns share
 * widths across the shipments, lots, invoices and kegs lists). `dense` tightens the rows to the ledger height.
 */
export function Table({ head, rows, caption, align, widths, dense = true, empty = "Nothing here yet." }: { head: string[]; rows: ReactNode[][]; caption?: string; align?: Align[]; widths?: Array<string | undefined>; dense?: boolean; empty?: string }) {
  const alignClass = (i: number) => (align?.[i] === "right" ? "text-right" : align?.[i] === "center" ? "text-center" : "text-left");
  const pad = dense ? "px-2 py-[5px] first:pl-0 last:pr-0" : "px-2 py-2.5 first:pl-0 last:pr-0";
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[640px] border-collapse text-[13px] leading-5">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {widths ? (
          <colgroup>
            {head.map((h, i) => (
              <col key={h} style={widths[i] ? { width: widths[i] } : undefined} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={`sticky top-0 z-[1] border-b border-rule bg-ground ${pad} align-bottom font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2 ${alignClass(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="py-5 text-ink-2">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-b border-rule-soft align-top hover:bg-hover">
                {r.map((c, j) => (
                  <td key={j} className={`${pad} ${alignClass(j)}`}>
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

/** Filters on one line: the form lays its children in a row that wraps on narrow screens. */
export function FilterBar({ children, ...rest }: React.FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  return (
    <form role="search" {...rest} className={`flex flex-wrap items-center gap-2 [&_input]:w-auto [&_select]:w-auto ${rest.className ?? ""}`}>
      {children}
    </form>
  );
}

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <div data-flash={error ? "error" : "ok"} className={`border-l-2 py-1 pl-3 text-sm ${error ? "border-ink text-ink" : "border-navy text-navy"}`} role={error ? "alert" : "status"} aria-live="polite">
      {error ? <strong className="font-semibold">Not done. </strong> : null}
      {error ?? ok}
    </div>
  );
}

const noticeLabel: Record<Tone, string> = { neutral: "", good: "", warn: "Note", danger: "Attention", info: "" };

/** A notice is a ruled line of text; its weight comes from the words, never from a colour. */
export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  void toneGlyph;
  const label = noticeLabel[tone];
  return (
    <div className={`border-l-2 py-1 pl-3 text-sm ${tone === "danger" || tone === "warn" ? "border-ink text-ink" : "border-rule text-ink-2"}`} role="status">
      {title ? <strong className="mr-1 font-semibold text-ink">{title}</strong> : label ? <strong className="mr-1 font-semibold text-ink">{label}:</strong> : null}
      {children}
    </div>
  );
}

/** Plain-language state line: kind decides the label; text carries the consequence and who acts next (UX-04). */
export function StateLine({ kind, children }: { kind: "info" | "action_needed" | "blocked" | "unresolved_decision" | "provider_unavailable" | "failure"; children: ReactNode }) {
  const label = {
    info: "Info",
    action_needed: "Action needed",
    blocked: "Blocked",
    unresolved_decision: "Owner decision",
    provider_unavailable: "Provider not available",
    failure: "Technical problem",
  }[kind];
  const strong = kind === "blocked" || kind === "failure" || kind === "action_needed";
  return (
    <p className="flex items-start gap-2 text-sm">
      <span className={`whitespace-nowrap text-[12px] ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>{label}</span>
      <span>{children}</span>
    </p>
  );
}
