export type DecisionRegister = "D" | "SD" | "T" | "IG";

export interface DecisionSeed {
  id: string;
  register: DecisionRegister;
  title: string;
  question: string;
  confirmedBehavior: string;
  safeSupport: string;
  keepInactive: string;
  accountable: string;
  /** Structured keys the application consults once a selection exists. */
  selectionSchema?: Record<string, string>;
}

/**
 * Result of a policy lookup. "unselected" is a first-class business meaning —
 * not off, zero, approved or a vendor default (brief §2.2). Code that needs a
 * selection must keep the affected branch inactive and surface the question.
 */
export type PolicyLookup<T extends Record<string, unknown> = Record<string, unknown>> =
  | { status: "unselected"; decisionId: string }
  | {
      status: "selected";
      decisionId: string;
      kind: "production" | "test";
      selection: T;
      scope: string;
      effectiveFrom: Date;
      selectionId: string;
    };
