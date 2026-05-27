import type { ConfigView } from "./api";
import { nestedGet } from "./flatten";
import type { FieldSpec } from "./types";

// Form state stores every value as a string (booleans as "true"/"false")
// so inputs stay fully controlled and editable; we coerce back to the
// schema's exact type only at PATCH time.
export type FormValues = Record<string, string>;

function toFormString(field: FieldSpec, raw: unknown): string {
    if (raw === undefined || raw === null) {
        if (field.type === "boolean") return field.default === true ? "true" : "false";
        return field.default != null ? String(field.default) : "";
    }
    if (field.type === "boolean") return raw ? "true" : "false";
    return String(raw);
}

// The persisted/intended value for a field — what the form shows and what
// dirty-tracking compares against. Sensitive fields are never echoed into the
// form; they show empty with a masked placeholder.
export function baselineString(field: FieldSpec, view: ConfigView | null): string {
    if (field.sensitive) return "";
    if (!view) return toFormString(field, field.default);

    // Env overrides win at runtime and can't be changed here, so reflect the
    // effective (env) value as-is; the control renders read-only.
    if (view.sources[field.key] === "env") {
        return toFormString(field, nestedGet(view.effective, field.key));
    }

    // Otherwise show the persisted intent — the value that will be in effect
    // once any pending restart lands: the file override if present, else the
    // built-in default. We deliberately do NOT fall back to `effective`: for
    // restart-required keys it stays pinned to the running (pre-restart)
    // value, so using it would make a just-saved change read as still-dirty —
    // most visibly when reverting a restart key to its default, which prunes
    // the file entry entirely.
    const fileVal = nestedGet(view.file, field.key);
    return toFormString(field, fileVal !== undefined ? fileVal : field.default);
}

// Coerces a form string to the exact JS type the backend validator expects.
export function toPatchValue(field: FieldSpec, value: string): unknown {
    if (field.type === "boolean") return value === "true";
    if (field.type === "integer") return Number(value);
    return value;
}

// A locale-independent client validation result. The hook resolves it to a
// message at render time (validateClient is a pure function, so it cannot call
// hooks itself); param carries the bound (min/max) for the ranged variants.
export type ClientValidationError =
    | { kind: "required" }
    | { kind: "integer" }
    | { kind: "min"; param: number }
    | { kind: "max"; param: number };

// Light client-side guard, mainly to avoid sending NaN for integer fields
// and to give instant range feedback. The backend remains authoritative.
export function validateClient(field: FieldSpec, value: string): ClientValidationError | null {
    if (field.type === "integer") {
        const trimmed = value.trim();
        if (trimmed === "") return { kind: "required" };
        const n = Number(trimmed);
        if (!Number.isFinite(n) || !Number.isInteger(n)) return { kind: "integer" };
        if (field.minimum != null && n < field.minimum) return { kind: "min", param: field.minimum };
        if (field.maximum != null && n > field.maximum) return { kind: "max", param: field.maximum };
    }
    return null;
}
