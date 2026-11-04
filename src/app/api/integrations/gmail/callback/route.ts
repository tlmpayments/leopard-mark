import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit/record";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { baseUrl } from "@/lib/env";
import { SCOPE_LABEL, companyMailboxes, saveMailboxConnection } from "@/lib/integrations/gmail/connection";
import { completeMailboxConnect } from "@/lib/integrations/gmail/oauth";

/**
 * Google's return from a mailbox sign-in. The mailbox Google signed in must be the one the Owner asked to connect, and
 * every scope that mailbox needs must have been allowed; otherwise nothing is kept.
 */
export async function GET(req: NextRequest) {
  const actor = await requireAction("settings.manage");
  const back = (key: "ok" | "error", message: string) => NextResponse.redirect(new URL(`/integrations?${key}=${encodeURIComponent(message)}`, baseUrl()));
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (req.nextUrl.searchParams.get("error")) return back("error", "Google sign-in was cancelled; the mailbox is not connected.");
  if (!code || !state) return back("error", "Google did not return a sign-in; start again.");
  const db = await getDb();
  try {
    const grant = await completeMailboxConnect(code, state);
    if (grant.mailbox !== grant.requested) {
      await recordAudit(db, actor, { action: "gmail.mailbox_refused", subjectType: "mailbox", subjectId: grant.requested, current: { signedInAs: grant.mailbox }, reason: "signed in to a different mailbox" });
      return back("error", `You signed in as ${grant.mailbox}, not ${grant.requested}. Nothing was kept; connect again and choose ${grant.requested}.`);
    }
    const needed = companyMailboxes(await getCompanySettings(db)).find((m) => m.mailbox === grant.mailbox)?.scopes ?? [];
    const missing = needed.filter((s) => !grant.scopes.includes(s));
    if (missing.length) {
      return back("error", `Google was not allowed to ${missing.map((s) => SCOPE_LABEL[s] ?? s).join(" and ")} for ${grant.mailbox}. Nothing was kept; connect again and tick every box Google shows.`);
    }
    await saveMailboxConnection(db, actor, { mailbox: grant.mailbox, refreshToken: grant.refreshToken, scopes: grant.scopes.filter((s) => s.includes("gmail")) });
    return back("ok", `${grant.mailbox} is connected (${needed.map((s) => SCOPE_LABEL[s] ?? s).join(" and ")}). Reading and sending still follow the switches in Company settings.`);
  } catch (err) {
    return back("error", err instanceof Error ? err.message : "The mailbox could not be connected");
  }
}
