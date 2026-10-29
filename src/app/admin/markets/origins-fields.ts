/** Shared constants for the origins editor (no server-only code). */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const ORIGIN_KIND_LABEL: Record<string, string> = { brewery: "Brewery (lot facility)", warehouse: "Warehouse", cold_storage: "Cold storage" };
