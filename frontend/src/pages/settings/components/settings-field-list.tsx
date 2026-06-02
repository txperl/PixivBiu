import { type ConfigSource, type FieldSpec, isFieldVisible } from "@/features/settings";
import { cn } from "@/lib/utils";
import { SettingsField } from "./settings-field";

// FieldRowProps is the "form slice" every field row needs: current values,
// per-field validation/source metadata, and the change/reset callbacks. Shared
// by the section card and the About card so the two never drift.
export interface FieldRowProps {
    values: Record<string, string>;
    fieldErrors: Record<string, string>;
    sources: Record<string, ConfigSource>;
    overriddenKeys: Set<string>;
    pendingRestart: Set<string>;
    busyKeys: Set<string>;
    showAdvanced: boolean;
    onChange: (key: string, value: string) => void;
    onResetField: (key: string) => void;
}

// SettingsFieldList renders the advanced-aware list of SettingsField rows that
// every settings card shares. Returns null when nothing is visible so a card
// never shows an empty divider block.
export function SettingsFieldList({
    fields,
    className,
    values,
    fieldErrors,
    sources,
    overriddenKeys,
    pendingRestart,
    busyKeys,
    showAdvanced,
    onChange,
    onResetField,
}: FieldRowProps & { fields: FieldSpec[]; className?: string }) {
    const visibleFields = fields.filter((f) => isFieldVisible(f, showAdvanced));
    if (visibleFields.length === 0) return null;
    return (
        <div className={cn("divide-y divide-muted/40 px-[18px]", className)}>
            {visibleFields.map((field) => (
                <SettingsField
                    key={field.key}
                    field={field}
                    value={values[field.key] ?? ""}
                    error={fieldErrors[field.key]}
                    source={sources[field.key]}
                    overridden={overriddenKeys.has(field.key)}
                    pendingRestart={pendingRestart.has(field.key)}
                    busy={busyKeys.has(field.key)}
                    onChange={(v) => onChange(field.key, v)}
                    onReset={() => onResetField(field.key)}
                />
            ))}
        </div>
    );
}
