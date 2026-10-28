import { NextResponse } from "next/server";
import { beginGoogleSignIn, googleConfigured } from "@/lib/auth/google";

export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/sign-in?reason=google_not_configured", process.env.APP_BASE_URL ?? "http://localhost:3000"));
  }
  const url = await beginGoogleSignIn();
  return NextResponse.redirect(url);
}
