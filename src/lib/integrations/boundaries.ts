/**
 * Boundary-only provider modules (this repository revision).
 *
 * Each module below records the authority boundary from brief §4/§54 and
 * throws NotBuiltError from any consequential operation so that no screen or
 * job can pretend a provider effect happened. When the phase that needs the
 * provider is built, the adapter replaces these functions and the
 * integration status moves from NOT IMPLEMENTED / IMPLEMENTED-NOT-CONNECTED
 * through the build-versus-activate states.
 */
export class NotBuiltError extends Error {
  readonly provider: string;
  readonly phase: number;
  constructor(provider: string, operation: string, phase: number) {
    super(`${provider}: "${operation}" is not built in this revision (phase ${phase}). No provider effect was attempted.`);
    this.name = "NotBuiltError";
    this.provider = provider;
    this.phase = phase;
  }
}

export const optimoroute = {
  boundary:
    "OptimoRoute computes routes, dispatches live driver instructions and captures native observations/POD. Internal owns eligible work, released commitment, accepted actuals, residual demand and change acknowledgement (brief §20). Held demand is never sent as a ready stop.",
  releaseWork(): never {
    throw new NotBuiltError("OptimoRoute", "release authorized work", 2);
  },
  observeCompletion(): never {
    throw new NotBuiltError("OptimoRoute", "observe stop completion", 2);
  },
};

export const gmail = {
  boundary:
    "Gmail is low-volume transport and human reply conversation, never the business archive (brief §42.2). Notice intent, version, recipient and outcome are internal records; send acceptance is not inbox delivery. Sender allocation per purpose is D32/IG04 and remains unselected — notices are recorded as manual-pending for the authorized single-sender process.",
  send(): never {
    throw new NotBuiltError("Gmail", "automated send", 1);
  },
};

export const slack = {
  boundary:
    "Slack carries actionable category/market alerts and daily summaries (brief §42.3). Reactions, edits, threads and deletions never perform a business transition. Channel routing is IG07/D32 (unselected).",
  post(): never {
    throw new NotBuiltError("Slack", "post alert", 1);
  },
};

export const googleAddress = {
  boundary:
    "Google address assessment is advisory provider content (brief §10). Customer-confirmed address facts are retained independently; raw response/geocode is not archived and is never forwarded onward (e.g. to OptimoRoute) without an IG05 permission decision.",
  assess(): never {
    throw new NotBuiltError("Google Address", "assess address", 1);
  },
};

export const qbo = {
  boundary:
    "QuickBooks Online is the formal general ledger (brief §46). No posting model is selected (IG06/D29); exactly one accounting writer per economic effect must be designated by the accountant before any posting. QBO never issues customer invoices or collects.",
  post(): never {
    throw new NotBuiltError("QuickBooks Online", "post accounting effect", 3);
  },
};
