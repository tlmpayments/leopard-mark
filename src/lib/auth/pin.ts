import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { BusinessError } from "@/lib/errors";

/**
 * Employee sign-in PIN: policy, hashing and verification. No dependency
 * beyond node:crypto. A PIN is 6–12 digits chosen by the person; trivially
 * guessable patterns are refused. Only an scrypt hash is ever stored
 * (`scrypt$N$r$p$<salt>$<hash>`), and comparison is constant-time.
 */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));
}

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 12;
/** Failed attempts before the credential locks. */
export const PIN_LOCK_AFTER = 5;
/** First lockout; each further failure while locked out doubles it, up to the cap. */
export const PIN_LOCK_BASE_MS = 15 * 60_000;
export const PIN_LOCK_MAX_MS = 24 * 3_600_000;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/** Throws a displayable BusinessError when the PIN does not meet the policy. */
export function validatePinPolicy(pin: string, field = "pin"): void {
  if (!/^\d+$/.test(pin)) throw new BusinessError("A PIN is digits only.", { field });
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) throw new BusinessError(`A PIN is ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`, { field });
  if (/^(\d)\1+$/.test(pin)) throw new BusinessError("A PIN cannot be one repeated digit.", { field });
  if (isRun(pin)) throw new BusinessError("A PIN cannot be a straight run of digits (like 123456 or 987654).", { field });
  if (pin.length % 2 === 0 && /^(\d\d)\1+$/.test(pin)) throw new BusinessError("A PIN cannot be one pair of digits repeated.", { field });
}

function isRun(pin: string): boolean {
  let up = true;
  let down = true;
  for (let i = 1; i < pin.length; i++) {
    const d = Number(pin[i]) - Number(pin[i - 1]);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64url");
  const key = await scrypt(pin, Buffer.from(saltB64, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash of a random PIN, verified against unknown emails so timing does not reveal whether an email exists. */
let dummyHashPromise: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPin(generatePin(8));
  return dummyHashPromise;
}

/** A random PIN that satisfies the policy (for temporary PINs minted by an operator script). */
export function generatePin(length = 8): string {
  for (;;) {
    let pin = "";
    for (let i = 0; i < length; i++) pin += String(randomInt(0, 10));
    try {
      validatePinPolicy(pin);
      return pin;
    } catch {
      /* try again */
    }
  }
}

/** Lockout length after `failures` consecutive failed attempts (0 while under the threshold). */
export function lockoutMs(failures: number): number {
  if (failures < PIN_LOCK_AFTER) return 0;
  return Math.min(PIN_LOCK_BASE_MS * 2 ** (failures - PIN_LOCK_AFTER), PIN_LOCK_MAX_MS);
}
