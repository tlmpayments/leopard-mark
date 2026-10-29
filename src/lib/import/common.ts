/** Shared helpers for the normaliser modules: the flag/exclusion collector and the name keys used to match rows across tabs. */
import type { Excluded, Flag } from "./types";

export interface NormalizeContext {
  flags: Flag[];
  excluded: Excluded[];
  flag(entity: string, key: string, message: string): void;
  exclude(entity: string, key: string, reason: string): void;
}

export function makeContext(): NormalizeContext {
  const flags: Flag[] = [];
  const excluded: Excluded[] = [];
  const flagKeys = new Set<string>();
  const exclKeys = new Set<string>();
  return {
    flags,
    excluded,
    flag: (entity, key, message) => {
      const k = `${entity}|${key}|${message}`;
      if (flagKeys.has(k)) return;
      flagKeys.add(k);
      flags.push({ entity, key, message });
    },
    exclude: (entity, key, reason) => {
      const k = `${entity}|${key}`;
      if (exclKeys.has(k)) return;
      exclKeys.add(k);
      excluded.push({ entity, key, reason });
    },
  };
}

/** Trade-name key used for matching accounts across tabs and the BOL log (the production id uses the same lower-casing). */
export function nameKey(s: string): string {
  return s.replace(/ /g, " ").trim().toLowerCase();
}

/** Looser key: letters and digits only, company suffixes dropped, for Sales "Customer" strings and freight names. */
export function looseKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|l p ship|lp|ltd|co|corp|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
