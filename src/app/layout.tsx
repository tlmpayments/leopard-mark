import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { currentActor } from "@/lib/auth/current";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leopard Mark Ops",
  description: "Familiar Ventures self-distribution operating system",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Shell actor={actor}>{children}</Shell>
      </body>
    </html>
  );
}
