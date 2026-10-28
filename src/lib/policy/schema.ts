/**
 * Typed interpretation of a decision's `selectionSchema` (the human hints in
 * the register: "true|false", "integer …", "one of: a | b", "list of market
 * codes …", "free text", "object purpose -> …"). The register text is the
 * source of truth (generated from the brief); this module only derives
 * field types from it so the UI can offer real controls and the service can
 * refuse malformed values (§4.5, UX-07, REV-16).
 *
 * Nothing here invents options: enum values come from the hint text itself.
 */
export type FieldType =
  | { kind: "boolean" }
  | { kind: "integer" }
  | { kind: "enum"; options: string[] }
  | { kind: "string_list" }
  | { kind: "text" }
  | { kind: "object" };

export interface FieldSpec {
  key: string;
  hint: string;
  type: FieldType;
}

export function parseFieldType(hint: string): FieldType {
  const h = hint.trim();
  if (/^true\|false$/i.test(h)) return { kind: "boolean" };
  const oneOf = h.match(/^one of:\s*(.+)$/i);
  if (oneOf) return { kind: "enum", options: oneOf[1].split("|").map((s) => s.trim()).filter(Boolean) };
  if (/^integer\b/i.test(h)) return { kind: "integer" };
  if (/^list of\b/i.test(h)) return { kind: "string_list" };
  if (/^object\b/i.test(h)) return { kind: "object" };
  return { kind: "text" };
}

export function fieldSpecs(schema: Record<string, string> | null | undefined): FieldSpec[] {
  if (!schema) return [];
  return Object.entries(schema).map(([key, hint]) => ({ key, hint, type: parseFieldType(hint) }));
}

export interface SelectionValidation {
  /** Normalized value: only known keys, typed. Blank fields are omitted (unresolved), never defaulted. */
  value: Record<string, unknown>;
  presentKeys: string[];
  missingKeys: string[];
  errors: string[];
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
}

/**
 * Validate a raw selection (from a form or JSON) against the schema. Unknown
 * keys and wrong types are errors; blank fields are simply "unresolved".
 * A decision without a structured schema accepts any JSON object as a record
 * of the Owner's choice (execution is not implemented for those; the UI says so).
 */
export function validateSelection(schema: Record<string, string> | null | undefined, raw: unknown): SelectionValidation {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { value: {}, presentKeys: [], missingKeys: [], errors: ["Selection must be an object"] };
  }
  const input = raw as Record<string, unknown>;
  const specs = fieldSpecs(schema);
  if (specs.length === 0) {
    const presentKeys = Object.keys(input).filter((k) => !isBlank(input[k]));
    const value: Record<string, unknown> = {};
    for (const k of presentKeys) value[k] = input[k];
    return { value, presentKeys, missingKeys: [], errors };
  }
  const known = new Set(specs.map((s) => s.key));
  for (const k of Object.keys(input)) {
    if (!known.has(k)) errors.push(`unknown field "${k}"`);
  }
  const value: Record<string, unknown> = {};
  const presentKeys: string[] = [];
  const missingKeys: string[] = [];
  for (const spec of specs) {
    const v = input[spec.key];
    if (isBlank(v)) {
      missingKeys.push(spec.key);
      continue;
    }
    const coerced = coerce(spec, v);
    if (coerced.error) errors.push(`${spec.key}: ${coerced.error}`);
    else {
      value[spec.key] = coerced.value;
      presentKeys.push(spec.key);
    }
  }
  return { value, presentKeys, missingKeys, errors };
}

function coerce(spec: FieldSpec, v: unknown): { value?: unknown; error?: string } {
  switch (spec.type.kind) {
    case "boolean": {
      if (typeof v === "boolean") return { value: v };
      if (v === "true") return { value: true };
      if (v === "false") return { value: false };
      return { error: "must be true or false" };
    }
    case "integer": {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (!Number.isInteger(n) || n < 0) return { error: "must be a whole number ≥ 0" };
      return { value: n };
    }
    case "enum": {
      const s = String(v).trim();
      if (!spec.type.options.includes(s)) return { error: `must be one of ${spec.type.options.join(" | ")}` };
      return { value: s };
    }
    case "string_list": {
      const arr = Array.isArray(v) ? v : String(v).split(",");
      const list = arr.map((x) => String(x).trim()).filter(Boolean);
      if (!list.length) return { error: "must list at least one value" };
      return { value: list };
    }
    case "object": {
      if (typeof v === "string") {
        try {
          const parsed = JSON.parse(v);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { error: "must be a JSON object" };
          return { value: parsed };
        } catch {
          return { error: "must be a JSON object" };
        }
      }
      if (typeof v !== "object" || v === null || Array.isArray(v)) return { error: "must be an object" };
      return { value: v };
    }
    case "text":
      return { value: String(v).trim() };
  }
}
