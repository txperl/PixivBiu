import { CONTROL_OVERRIDE, FALLBACK_SECTION_ICON, SECTION_META } from "./presentation";
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
            description: node.description ?? "",
            default: node.default,
            enum: node.enum?.map(String),
            minimum: typeof node.minimum === "number" ? node.minimum : undefined,
            maximum: typeof node.maximum === "number" ? node.maximum : undefined,
            isDuration,
            sensitive: !!node["x-cfg-sensitive"],
            restartRequired: !!node["x-cfg-restart-required"],
            advanced: !!node["x-cfg-advanced"],
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
    for (const [category, sectionFields] of byCategory) {
        const meta = SECTION_META[category];
        sections.push({
            category,
            title: meta?.title ?? category,
            icon: meta?.icon ?? FALLBACK_SECTION_ICON,
            fields: sectionFields,
        });
    }

    sections.sort((a, b) => (SECTION_META[a.category]?.order ?? 99) - (SECTION_META[b.category]?.order ?? 99));
    return sections;
}
