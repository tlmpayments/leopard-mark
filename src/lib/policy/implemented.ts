/**
 * Which decisions the application actually EXECUTES when selected (§4.5,
 * UX-07). Everything else is a recorded choice with history whose execution
 * is not implemented — the register says so instead of pretending.
 */
export interface DecisionImplementation {
  /** What changes in the application when this is selected. */
  effect: string;
  /** Branches the code consults; missing keys stay unresolved. */
  executedKeys: string[];
  /** Keys recorded but not executed in this revision. */
  recordedOnlyKeys?: string[];
  /** Commissioning dependency, if any. */
  dependsOn?: string;
  /** Deterministic example of the behaviour for the preview. */
  example: (selection: Record<string, unknown>, marketCodes: string[]) => string;
}

export const IMPLEMENTED_DECISIONS: Record<string, DecisionImplementation> = {
  D01: {
    effect: "Second-delivery readiness: with readiness_interpretation = valid_authorization the location is releasable for a further delivery only when its payment method is usable and not revoked. The other interpretations need phase-3 payment evidence and are reported as not satisfied rather than assumed.",
    executedKeys: ["readiness_interpretation"],
    recordedOnlyKeys: ["fintech_equivalence", "partial_receipt_consumes_allowance", "zero_receipt_failure_consumes_allowance"],
    dependsOn: "Stripe hosted setup demonstrated (gate STRIPE_HOSTED_SETUP) before valid_authorization can ever be satisfied.",
    example: (s, m) => `In ${m.join(", ") || "the selected markets"}: a location with one accepted delivery ${s.readiness_interpretation === "valid_authorization" ? "becomes releasable again once its ACH method is usable" : `stays not releasable (interpretation "${String(s.readiness_interpretation ?? "?")}" is not executable yet)`}.`,
  },
  D02: {
    effect: "License verification requirement per market: markets listed in verification_required_markets need a verified license before first delivery; markets not listed are exempt and Admin may record 'not applicable'. With D02 unselected every market requires verification.",
    executedKeys: ["verification_required_markets"],
    example: (s, m) => {
      const req = Array.isArray(s.verification_required_markets) ? (s.verification_required_markets as string[]) : [];
      const exempt = m.filter((c) => !req.includes(c));
      return `Verification required in: ${req.join(", ") || "none listed"}. Exempt (within scope): ${exempt.join(", ") || "none"}. Open license cases in exempt markets resolve; withdrawing reopens them.`;
    },
  },
  D09: {
    effect: "Abnormal-order flagging (never rejection): a line above abnormal_max_line_qty or an order above abnormal_max_order_units is flagged for confirmation at submission.",
    executedKeys: ["abnormal_max_line_qty", "abnormal_max_order_units"],
    example: (s) => `An order with a line of ${Number(s.abnormal_max_line_qty) + 1 || "N+1"} units${s.abnormal_max_order_units ? ` or ${Number(s.abnormal_max_order_units) + 1} units in total` : ""} is flagged; nothing is refused.`,
  },
  D11: {
    effect: "Value basis for the $90 minimum: value_basis decides whether keg deposits count. Orders below the basis are captured and flagged for Admin. combine_same_visit and below_minimum_pending are recorded only (no delivery consolidation exists yet).",
    executedKeys: ["value_basis"],
    recordedOnlyKeys: ["combine_same_visit", "below_minimum_pending"],
    example: (s) => `A $70 merchandise order with one keg ($35 deposit) ${s.value_basis === "merchandise_plus_deposits" ? "meets" : s.value_basis === "merchandise_only" ? "is below" : "— basis not executable —"} the $90 minimum.`,
  },
  D13: {
    effect: "Standing-order generation: one occurrence per cadence_days cycle from the arrangement's creation; generate_when_held decides whether a held location still gets an order. BOTH keys are required to generate anything; archived products are skipped with a review case.",
    executedKeys: ["cadence_days", "generate_when_held"],
    example: (s) => `Every ${String(s.cadence_days ?? "?")} day(s) the current cycle's order is created${s.generate_when_held === false ? ", skipped (and owned) while the location is held" : s.generate_when_held === true ? ", even while held" : " — generate_when_held is unresolved, so nothing generates"}.`,
  },
};
