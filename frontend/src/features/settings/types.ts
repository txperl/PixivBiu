import type { IconSvgElement } from "@hugeicons/react";
import type { components } from "@/lib/api";

export type ConfigView = components["schemas"]["ConfigView"];
export type ConfigSource = components["schemas"]["ConfigSource"];
export type ConfigApiError = components["schemas"]["Error"];

// The leaf JSON-Schema "type" the backend emits (see internal/config/schema.go).
export type CfgType = "string" | "integer" | "boolean";

// Which form control renders a given field. Derived once in compileSchema
// from the field's type/format/enum plus the presentation overlay.
export type ControlKind =
    | "text"
    | "number"
    | "switch"
    | "select"
    | "duration"
    | "textarea"
    | "password"
    // Go text/template field with a token-insertion palette + live preview.
    | "template";

// A single leaf setting, flattened to its dotted key.
export interface FieldSpec {
    key: string; // dotted path, e.g. "download.max_concurrent"
    category: string; // top-level section ("download", "pixiv", …)
    type: CfgType;
    control: ControlKind;
    default: unknown;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    isDuration: boolean;
    sensitive: boolean;
    restartRequired: boolean;
    advanced: boolean;
    // Program-only (ops/maintenance): editable only by hand in the config
    // file. Rendered read-only and hidden behind the "advanced" toggle.
    internal: boolean;
    // Declaration-order index from the backend (x-cfg-order); fields are
    // sorted by it so the page mirrors the Go struct instead of the
    // alphabetical order the schema's properties map serializes to.
    order: number;
}

export interface SectionSpec {
    category: string;
    icon: IconSvgElement;
    fields: FieldSpec[];
}

// The subset of the JSON Schema document we actually read. The endpoint is
// typed as an opaque map upstream, so we narrow it here.
export interface JsonSchemaNode {
    type?: string;
    default?: unknown;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    format?: string;
    properties?: Record<string, JsonSchemaNode>;
    "x-cfg-category"?: string;
    "x-cfg-go-type"?: string;
    "x-cfg-sensitive"?: boolean;
    "x-cfg-restart-required"?: boolean;
    "x-cfg-advanced"?: boolean;
    "x-cfg-internal"?: boolean;
    "x-cfg-order"?: number;
}

export interface ConfigSchema extends JsonSchemaNode {
    "x-cfg-schema-version"?: string;
}
