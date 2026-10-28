import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/sign-in", req.url), { status: 303 });
}
