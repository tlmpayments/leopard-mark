import { NextResponse, type NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { baseUrl } from "@/lib/env";
import { companyMailboxes, googleClientConfigured } from "@/lib/integrations/gmail/connection";
import { beginMailboxConnect } from "@/lib/integrations/gmail/oauth";

/** Owner only: send the Owner to Google to sign in to one company mailbox (orders@ or operations@). */
export async function GET(req: NextRequest) {
  await requireAction("settings.manage");
  const back = (error: string) => NextResponse.redirect(new URL(`/integrations?error=${encodeURIComponent(error)}`, baseUrl()));
  if (!googleClientConfigured()) return back("The Google client is not configured: paste GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET into Vercel and redeploy.");
  const requested = (req.nextUrl.searchParams.get("mailbox") ?? "").trim().toLowerCase();
  const mailbox = companyMailboxes(await getCompanySettings(await getDb())).find((m) => m.mailbox === requested);
  if (!mailbox || !mailbox.scopes.length) return back("Only the mailboxes named in Company settings can be connected.");
  return NextResponse.redirect(await beginMailboxConnect(mailbox.mailbox, mailbox.scopes));
}
