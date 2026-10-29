"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  /** Other path prefixes that belong to this page (Batches belongs to Lots). */
  also?: string[];
}

function useIsCurrent() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
}

/** Navigation with the current route marked (aria-current): "bar" is the phone's bottom bar, "sidebar" a vertical list. */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: "sidebar" | "bar" }) {
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

/** A primary section of the shell and the pages it holds, already filtered to what the signed-in person may open. */
export interface NavSection {
  key: string;
  label: string;
  pages: NavItem[];
}

/**
 * Which section and page the current path belongs to: the page whose path (or one of its `also` paths) is the
 * longest prefix of the current path. Longest wins so /admin/markets lands on Markets & stock (Stock) and not on
 * the Command center at /admin (Exceptions). A path outside every visible page (home, search, menu) has no section.
 */
function useActive(sections: NavSection[]): { section: NavSection | null; page: string | null } {
  const pathname = usePathname();
  let best: { section: NavSection; page: string; length: number } | null = null;
  for (const section of sections) {
    for (const page of section.pages) {
      for (const p of [page.href, ...(page.also ?? [])]) {
        if (p === "/") continue;
        const hit = pathname === p || pathname.startsWith(`${p}/`);
        if (hit && (!best || p.length > best.length)) best = { section, page: page.href, length: p.length };
      }
    }
  }
  return best ? { section: best.section, page: best.page } : { section: null, page: null };
}

const rowLink = (current: boolean) =>
  `relative inline-flex h-[70px] shrink-0 items-center whitespace-nowrap text-sm ${current ? "font-semibold text-navy after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-navy" : "text-ink-2 hover:text-ink"}`;
const subLink = (current: boolean) => `inline-flex h-9 items-center whitespace-nowrap text-[13px] ${current ? "font-semibold text-navy" : "text-ink-2 hover:text-ink"}`;

/** The shell's primary line: one link per section (to the section's first page), the current section underlined. */
export function PrimaryNav({ sections }: { sections: NavSection[] }) {
  const { section: active } = useActive(sections);
  const ref = useRef<HTMLElement>(null);
  // On a window too narrow for the whole row, keep the current section in view.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active?.key]);
  return (
    // Never wraps: on a narrow window the row scrolls sideways inside its own space instead of running under the person's name.
    <nav ref={ref} aria-label="Main" className="hidden min-w-0 items-center gap-5 overflow-x-auto [scrollbar-width:none] sm:flex xl:gap-6 [&::-webkit-scrollbar]:hidden">
      {sections.map((s) => {
        const current = active?.key === s.key;
        return (
          <Link key={s.key} href={s.pages[0].href} aria-current={current ? "true" : undefined} className={rowLink(current)}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The second hairline line under the bar: the current section's pages, shown when that section holds more than one. */
export function GroupNav({ sections }: { sections: NavSection[] }) {
  const { section, page } = useActive(sections);
  if (!section || section.pages.length < 2) return null;
  return (
    <nav aria-label={section.label} className="hidden border-t border-rule-soft sm:block">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 px-4 sm:px-8">
        {section.pages.map((n) => {
          const current = n.href === page;
          return (
            <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={subLink(current)}>
              {n.label}
            </Link>
          );
        })}
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
