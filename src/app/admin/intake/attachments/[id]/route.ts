import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { safeFilename, textResponse } from "@/lib/documents/http";

/** GET /admin/intake/attachments/<id> — an attachment kept with an intake email, for the person reviewing it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return textResponse("Not found", 404);
  await requireAction("intake.handle");
  const [a] = await (await getDb()).select().from(schema.intakeAttachment).where(eq(schema.intakeAttachment.id, id));
  if (!a?.data) return textResponse("The attachment was not kept (too large) or does not exist", 404);
  return new Response(new Uint8Array(a.data), {
    status: 200,
    headers: { "Content-Type": a.mime ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${safeFilename([a.filename.replace(/\.[^.]+$/, "")], a.filename.split(".").pop() ?? "bin")}"`, "Cache-Control": "private, no-store" },
  });
}
