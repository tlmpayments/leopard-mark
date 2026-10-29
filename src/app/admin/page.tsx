import { redirect } from "next/navigation";
import type { SearchParams } from "@/lib/actions/helpers";

/** The Command center folded into Exceptions (R2-36); the old address keeps working. */
export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) u.set(k, v);
  const q = u.toString();
  redirect(q ? `/admin/exceptions?${q}` : "/admin/exceptions");
}
