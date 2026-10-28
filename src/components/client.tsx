"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Submit button with progress and double-click prevention (UX-03). This is a
 * courtesy for the person; replay protection is the server's submission key
 * and state predicates, never the spinner.
 */
export function SubmitButton({ children, className, name, value, disabled, ariaLabel }: { children: ReactNode; className: string; name?: string; value?: string; disabled?: boolean; ariaLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={disabled || pending} aria-disabled={disabled || pending} aria-busy={pending} aria-label={ariaLabel} className={className}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Working…</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export interface NavItem {
  href: string;
  label: string;
}

/** Navigation with the current route marked (aria-current) — desktop sidebar and mobile bar share it. */
export function NavLinks({ items, variant }: { items: NavItem[]; variant: "sidebar" | "bar" }) {
  const pathname = usePathname();
  const isCurrent = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));
  if (variant === "bar") {
    return (
      <>
        {items.map((n) => {
          const current = isCurrent(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={`flex min-h-11 flex-1 items-center justify-center px-1 text-center text-xs ${current ? "font-semibold text-accent" : "text-foreground"}`}>
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
          <Link key={n.href} href={n.href} aria-current={current ? "page" : undefined} className={`rounded-lg px-2 py-2 text-sm hover:bg-background ${current ? "bg-background font-semibold" : ""}`}>
            {n.label}
          </Link>
        );
      })}
    </>
  );
}
