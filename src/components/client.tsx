"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with progress and double-click prevention (UX-03). This is a
 * courtesy for the person; replay protection is the server's submission key
 * and state predicates, never the spinner. The label keeps its width while
 * pending so the layout does not jump.
 */
export function SubmitButton({ children, className, name, value, disabled, ariaLabel }: { children: ReactNode; className: string; name?: string; value?: string; disabled?: boolean; ariaLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={disabled || pending} aria-disabled={disabled || pending} aria-busy={pending} aria-label={ariaLabel} className={className}>
      <span className={`inline-grid place-items-center [grid-template-areas:'a']`}>
        <span className={`[grid-area:a] ${pending ? "invisible" : ""}`}>{children}</span>
        <span className={`[grid-area:a] ${pending ? "" : "invisible"}`} aria-hidden={!pending}>
          Working
        </span>
      </span>
    </button>
  );
}

export interface NavItem {
  href: string;
  label: string;
  /** Other paths that count as this item being current (a group's members). */
  also?: string[];
}

function useIsCurrent() {
  const pathname = usePathname();
  const one = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  return (href: string, also?: string[]) => one(href) || (also ?? []).some(one);
}

/** Navigation with the current route marked (aria-current). "row" is the shell's primary line; "bar" the phone's bottom bar; "sidebar" a vertical list (menu page). */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: "sidebar" | "bar" | "row" | "subrow" }) {
  const isCurrent = useIsCurrent();
  if (variant === "bar") {
    return (
      <>
        {items.map((n) => {
          const current = isCurrent(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={`flex min-h-11 flex-1 items-center justify-center px-1 text-center text-xs ${current ? "font-semibold text-navy" : "text-ink-2"}`}>
              {n.label}
            </Link>
          );
        })}
      </>
    );
  }
  if (variant === "row" || variant === "subrow") {
    const row = variant === "row";
    return (
      <>
        {items.map((n) => {
          const current = isCurrent(n.href, n.also);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={current ? "page" : undefined}
              className={`relative inline-flex items-center whitespace-nowrap ${row ? "h-[70px] text-sm" : "h-9 text-[13px]"} ${current ? "font-semibold text-navy" : "text-ink-2 hover:text-ink"} ${current && row ? "after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-navy" : ""}`}
            >
              {n.label}
            </Link>
          );
        })}
      </>
    );
  }
  return (
    <>
      {items.map((n) => {
        const current = isCurrent(n.href);
        return (
          <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={`border-b border-rule-soft px-1 py-2.5 text-sm ${current ? "font-semibold text-navy" : "text-ink"}`}>
            {n.label}
          </Link>
        );
      })}
    </>
  );
}

/** The shell's primary line. Groups are plain data from the server; GroupNav below shows the open group's second line. */
export function PrimaryNav({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Main" className="hidden items-center gap-6 sm:flex">
      <NavLinks items={items} variant="row" />
    </nav>
  );
}

/** The second line under the bar: shown only while the current page belongs to one of the groups (Admin). */
export function GroupNav({ groups }: { groups: Array<{ href: string; label: string; items: NavItem[] }> }) {
  const isCurrent = useIsCurrent();
  const open = groups.find((g) => g.items.some((n) => isCurrent(n.href)));
  if (!open) return null;
  return (
    <nav aria-label={open.label} className="hidden border-t border-rule-soft sm:block">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 px-8">
        <NavLinks items={open.items} variant="subrow" />
      </div>
    </nav>
  );
}

/** Related items on a record page: one line of tabs, the panels below. No URL change; the first tab opens by default. */
export function Tabs({ tabs, initial }: { tabs: Array<{ id: string; label: string; count?: number | string | null; content: ReactNode }>; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const base = useId();
  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-x-6 border-b border-rule">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${base}-panel-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`-mb-px inline-flex h-10 items-center gap-2 border-b-2 text-sm ${on ? "border-navy font-semibold text-navy" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {t.label}
              {t.count !== undefined && t.count !== null ? <span className="text-xs tabular-nums text-ink-3">{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={t.id !== active} className="pt-4">
          {t.content}
        </div>
      ))}
    </div>
  );
}

/** A document number set large: click selects it whole; the small Copy puts it on the clipboard. */
export function CopyableNumber({ value, className = "" }: { value: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className={`inline-flex items-baseline gap-3 ${className}`}>
      <span className="select-all">{value}</span>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            /* clipboard refused: the number is still selectable */
          }
        }}
        className="font-sans text-xs tracking-normal text-ink-3 hover:text-navy"
        aria-label={`Copy ${value}`}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
