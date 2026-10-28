"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Input } from "@/components/ui";

export interface PickerLocation {
  id: string;
  tradeName: string;
  address: string;
  marketCode: string;
  status: string;
}

/** Searchable account selection that distinguishes identical names by address and market (UX-03/AC33). */
export function AccountPicker({ locations }: { locations: PickerLocation[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? locations.filter((l) => `${l.tradeName} ${l.address} ${l.marketCode}`.toLowerCase().includes(needle)) : locations;
  return (
    <div>
      <label htmlFor="account-search" className="mb-1 block text-sm font-medium">
        Find the account
      </label>
      <Input id="account-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, street or market…" autoFocus />
      <ul className="mt-2 divide-y divide-line" aria-live="polite">
        {shown.slice(0, 40).map((l) => (
          <li key={l.id}>
            <Link href={`/orders/new?locationId=${l.id}`} className="flex min-h-12 items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{l.tradeName}</span>
                <span className="block text-xs text-muted">{l.address}</span>
              </span>
              <Badge>{l.marketCode}</Badge>
            </Link>
          </li>
        ))}
        {shown.length === 0 ? <li className="py-3 text-sm text-muted">No account matches. Check the spelling, or create the account first.</li> : null}
      </ul>
      {shown.length > 40 ? <p className="mt-1 text-xs text-muted">Showing 40 of {shown.length} — keep typing.</p> : null}
    </div>
  );
}
