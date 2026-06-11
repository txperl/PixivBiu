import { CONTROL_OVERRIDE, FALLBACK_SECTION_ICON, isAdvanced, SECTION_ICONS } from "./presentation";
import type { CfgType, ConfigSchema, ControlKind, FieldSpec, JsonSchemaNode, SectionSpec } from "./types";

function deriveControl(node: JsonSchemaNode, key: string, type: CfgType, isDuration: boolean): ControlKind {
    const override = CONTROL_OVERRIDE[key];
    if (override) return override;
    if (node["x-cfg-sensitive"]) return "password";
    if (node.enum && node.enum.length > 0) return "select";
    if (isDuration) return "duration";
    if (type === "boolean") return "switch";
    if (type === "integer") return "number";
    return "text";
}

// Recursively flattens the nested JSON Schema `properties` into leaf
// FieldSpecs. Intermediate objects (server.timeouts, download.retry, …)
// just deepen the dotted key; the category propagates down.
function walk(props: Record<string, JsonSchemaNode>, prefix: string, category: string, out: FieldSpec[]): void {
    for (const [name, node] of Object.entries(props)) {
        const key = prefix ? `${prefix}.${name}` : name;
        const cat = node["x-cfg-category"] ?? category;

        if (node.type === "object" && node.properties) {
            walk(node.properties, key, cat, out);
            continue;
        }

        const type = (node.type as CfgType) ?? "string";
        const isDuration = node.format === "duration" || node["x-cfg-go-type"] === "duration";
        out.push({
            key,
            category: cat,
            type,
            control: deriveControl(node, key, type, isDuration),
            default: node.default,
            enum: node.enum?.map(String),
            minimum: typeof node.minimum === "number" ? node.minimum : undefined,
            maximum: typeof node.maximum === "number" ? node.maximum : undefined,
            isDuration,
            sensitive: !!node["x-cfg-sensitive"],
            restartRequired: !!node["x-cfg-restart-required"],
            advanced: !!node["x-cfg-advanced"],
            internal: !!node["x-cfg-internal"],
            order: typeof node["x-cfg-order"] === "number" ? node["x-cfg-order"] : 0,
        });
    }
}

// Turns the reflected JSON Schema into ordered sections of leaf fields.
export function compileSchema(schema: ConfigSchema): SectionSpec[] {
    const fields: FieldSpec[] = [];
    walk(schema.properties ?? {}, "", "", fields);

    const byCategory = new Map<string, FieldSpec[]>();
    for (const field of fields) {
        const arr = byCategory.get(field.category);
        if (arr) arr.push(field);
        else byCategory.set(field.category, [field]);
    }

    const sections: SectionSpec[] = [];
    const byOrder = (a: FieldSpec, b: FieldSpec) => a.order - b.order;
    // A category's position mirrors its earliest field: x-cfg-order is a
    // monotonic struct-declaration index, so a category's minimum field order
    // is where it sits in the Go config struct. Deriving section order this way
    // keeps it in lockstep with the backend — no hand-maintained order list.
    const minOrder = new Map<string, number>();
    for (const [category, sectionFields] of byCategory) {
        // Within a section, the advanced/internal tier sinks below the everyday
        // fields. Each group is sorted by x-cfg-order so it follows the Go
        // struct declaration order rather than the alphabetical order the
        // schema's properties map serializes to.
        const fields = [
            ...sectionFields.filter((f) => !isAdvanced(f)).sort(byOrder),
            ...sectionFields.filter((f) => isAdvanced(f)).sort(byOrder),
        ];
        minOrder.set(category, Math.min(...sectionFields.map((f) => f.order)));
        sections.push({
            category,
            icon: SECTION_ICONS[category] ?? FALLBACK_SECTION_ICON,
            fields,
        });
    }

    // A wholly advanced/internal section sinks below the rest; same-tier ties
    // order by the category's earliest field (struct declaration order).
    sections.sort((a, b) => {
        const advA = a.fields.every(isAdvanced);
        const advB = b.fields.every(isAdvanced);
        if (advA !== advB) return advA ? 1 : -1;
        return (minOrder.get(a.category) ?? 0) - (minOrder.get(b.category) ?? 0);
    });
    return sections;
}
