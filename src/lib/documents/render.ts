/**
 * PDF rendering entry point. The shipments and invoices services call `renderPdf` through this module so that the
 * domain layer never depends on the rendering library directly. The real renderer (src/lib/documents/pdf.tsx,
 * @react-pdf/renderer) registers itself at module load; until it does, `renderPdf` returns null and documents are
 * stored as snapshots only — the business flow never blocks on a rendering failure (6.7).
 */
import type { AnySnapshot, InvoiceSnapshot, Renderer, ShipmentSnapshot } from "./types";

let renderer: Renderer | null = null;

export function registerRenderer(r: Renderer) {
  renderer = r;
}

export function hasRenderer(): boolean {
  return renderer !== null;
}

export type RenderInput = AnySnapshot | { kind: "pickup_pack"; bol: ShipmentSnapshot; invoice: InvoiceSnapshot | null } | { kind: "batch"; documents: AnySnapshot[] };

/** Returns PDF bytes, or null when no renderer is registered or rendering fails (the failure is reported by the caller). */
export async function renderPdf(input: RenderInput): Promise<Buffer | null> {
  if (!renderer) return null;
  return renderer(input);
}
