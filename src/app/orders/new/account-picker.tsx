"use client";

import Link from "next/link";
import { useState } from "react";
import { Input } from "@/components/ui";

export interface PickerLocation {
  id: string;
  tradeName: string;
  address: string;
  marketCode: string;
  status: string;
  /** Accounts, or the samples recipients of a market (the samples house and reps' home addresses, R2-27, R2-28). */
  group: "accounts" | "samples";
}

/** Searchable account selection that distinguishes identical names by address and market (UX-03/AC33). */
export function AccountPicker({ locations }: { locations: PickerLocation[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? locations.filter((l) => `${l.tradeName} ${l.address} ${l.marketCode}`.toLowerCase().includes(needle)) : locations;
  const accounts = shown.filter((l) => l.group === "accounts").slice(0, 40);
  const samples = shown.filter((l) => l.group === "samples");
  const row = (l: PickerLocation) => (
    <li key={l.id}>
      <Link href={`/orders/new?locationId=${l.id}`} className="flex min-h-11 items-center justify-between gap-3 py-1.5 text-sm hover:text-navy">
        <span className="min-w-0">
          <span className="block">{l.tradeName}</span>
          <span className="block text-xs text-ink-3">{l.address}</span>
        </span>
        <span className="font-display text-[11px] tracking-[0.08em] text-ink-2">{l.marketCode}</span>
      </Link>
    </li>
  );
  return (
    <div>
      <label htmlFor="account-search" className="mb-1 block text-sm text-ink-2">
        Find the account
      </label>
      <Input id="account-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, street or market" autoFocus />
      <ul className="mt-2 divide-y divide-rule-soft" aria-live="polite">
        {accounts.map(row)}
        {accounts.length === 0 && samples.length === 0 ? <li className="py-3 text-sm text-ink-2">No account matches. Check the spelling, or create the account first.</li> : null}
      </ul>
      {shown.filter((l) => l.group === "accounts").length > 40 ? <p className="mt-1 text-xs text-ink-3">Showing 40 of {shown.filter((l) => l.group === "accounts").length}; keep typing.</p> : null}
      {samples.length ? (
        <>
          <div className="mt-5 font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">Samples recipients</div>
          <ul className="divide-y divide-rule-soft">{samples.map(row)}</ul>
        </>
      ) : null}
    </div>
  );
}
