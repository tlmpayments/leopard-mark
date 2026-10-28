/**
 * Error classes that separate expected business refusals (safe to show to
 * the person verbatim) from technical failures (logged server-side with a
 * reference; never echoed into URLs, pages or activity views — UX-10).
 */

/** A refusal the business rules explain in plain language. Safe to display. */
export class BusinessError extends Error {
  readonly field?: string;
  /** Machine-readable reason for tests and UI mapping (e.g. "stale_state"). */
  readonly code?: string;
  constructor(message: string, opts: { field?: string; code?: string } = {}) {
    super(message);
    this.name = "BusinessError";
    this.field = opts.field;
    this.code = opts.code;
  }
}

/** The request referred to a state that has since changed (stale page / concurrent action). */
export class StaleStateError extends BusinessError {
  constructor(message: string) {
    super(message, { code: "stale_state" });
    this.name = "StaleStateError";
  }
}

/** Deployment/configuration contradiction: the process refuses rather than guessing (REV-02). */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Errors whose message is written for people and names no internals beyond a setting's name. */
export function isDisplayableError(err: unknown): err is Error {
  return err instanceof BusinessError || err instanceof ConfigurationError || (err instanceof Error && err.name === "AuthorizationError");
}
