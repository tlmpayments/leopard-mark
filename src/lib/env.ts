import { ConfigurationError } from "./errors";

/**
 * Environment access in one place. Secrets are never logged or exposed; this
 * module only reports presence/absence for status screens.
 *
 * Deployment safety (REV-02 / AC04 / UX-11):
 *   - FV_ENV must be one of development | test | production. Any other value
 *     is a configuration error: the process refuses rather than defaulting to
 *     the most permissive mode.
 *   - A *deployment* is any process with NODE_ENV=production (every
 *     `next build` / `next start`) or Vercel variables present (production
 *     AND preview). On a deployment, fixture sign-in and demo mode are
 *     impossible whatever DEV_AUTH_BYPASS / FV_DEMO / FV_ENV say.
 *   - FV_ENV=development on a production build is contradictory for fixture
 *     purposes (deployment wins); FV_ENV=production on a dev server simply
 *     disables the local aids.
 */
export type AppEnv = "development" | "test" | "production";

const VALID: AppEnv[] = ["development", "test", "production"];

/** True when this process is a deployment (production build or any Vercel environment). */
export function isDeployment(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL) || Boolean(process.env.VERCEL_ENV);
}

export function appEnv(): AppEnv {
  const raw = process.env.FV_ENV;
  if (raw === undefined || raw === "") {
    return process.env.NODE_ENV === "production" ? "production" : "development";
  }
  if ((VALID as string[]).includes(raw)) return raw as AppEnv;
  throw new ConfigurationError(`FV_ENV must be one of development | test | production (got "${raw}"). Refusing to guess.`);
}

export function isProduction(): boolean {
  return appEnv() === "production";
}

/**
 * DEVELOPMENT DEMO MODE — zero-setup local inspection of the portal.
 *
 * When enabled the app uses an embedded PGlite database (./.fv-demo/), seeds
 * representative demo data on first start, and auto-authenticates the local
 * user as the demo Owner. No Google, Neon, Stripe or other provider is
 * involved; provider-dependent screens show their real NOT CONNECTED state.
 *
 * It is impossible to enable outside local development:
 *   - never on a deployment (production build, Vercel production or preview)
 *   - never when FV_ENV=production
 * Otherwise it is on when FV_DEMO=true (npm run demo) or when no DATABASE_URL is
 * configured at all (plain `npm run dev` on a fresh checkout). FV_DEMO=false
 * forces it off. It never activates because a real database connection
 * failed: a configured DATABASE_URL always means the real Postgres path.
 */
export function demoModeEnabled(): boolean {
  if (isDeployment()) return false;
  if (appEnv() === "production") return false;
  if (process.env.FV_DEMO === "false") return false;
  if (process.env.FV_DEMO === "true") return true;
  return !envPresent("DATABASE_URL");
}

/**
 * Local fixture mode: dev-fixture sign-in (a visible test aid) is available
 * only on a non-deployed process with FV_ENV development/test and an
 * explicit DEV_AUTH_BYPASS=true — or in demo mode, which implies it.
 */
export type FixtureMode = "off" | "local_demo" | "local_fixture";

export function fixtureMode(): FixtureMode {
  if (isDeployment()) return "off";
  if (appEnv() === "production") return "off";
  if (demoModeEnabled()) return "local_demo";
  if (process.env.DEV_AUTH_BYPASS === "true") return "local_fixture";
  return "off";
}

export function devAuthBypassEnabled(): boolean {
  return fixtureMode() !== "off";
}

/**
 * Human-readable configuration problems for the Integrations screen and the
 * deployment runbook. Never includes values, only variable names.
 */
export function configurationProblems(): string[] {
  const problems: string[] = [];
  try {
    appEnv();
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
  }
  if (isDeployment()) {
    if (process.env.DEV_AUTH_BYPASS === "true") problems.push("DEV_AUTH_BYPASS=true is set on a deployment; it is ignored (fixture sign-in stays off) — remove it.");
    if (process.env.FV_DEMO === "true") problems.push("FV_DEMO=true is set on a deployment; it is ignored (demo mode stays off) — remove it.");
    if (!envPresent("DATABASE_URL")) problems.push("DATABASE_URL is not configured on a deployment; the real Postgres path cannot start.");
    if (!envPresent("SESSION_SECRET")) problems.push("SESSION_SECRET is not configured; sessions cannot be issued.");
    if (process.env.FV_ENV === "development") problems.push("FV_ENV=development on a production build: test selections would apply. Set FV_ENV=production (or test for a preview with test data).");
  }
  return problems;
}

export function envPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigurationError(`Missing required environment variable ${name}`);
  return v;
}

export function baseUrl(): string {
  return process.env.APP_BASE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
}
