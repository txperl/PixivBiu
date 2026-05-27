import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import {
    type ConfigSource,
    isFieldVisible,
    SCROLL_OFFSET,
    type SectionSpec,
    useSectionDescription,
    useSectionTitle,
} from "@/features/settings";
import { useMessages } from "@/i18n";
import { SettingsField } from "./settings-field";

interface SettingsSectionProps {
    section: SectionSpec;
    values: Record<string, string>;
    fieldErrors: Record<string, string>;
    sources: Record<string, ConfigSource>;
    overriddenKeys: Set<string>;
    pendingRestart: Set<string>;
    busyKeys: Set<string>;
    showAdvanced: boolean;
    onChange: (key: string, value: string) => void;
    onResetField: (key: string) => void;
    onResetSection: (category: string) => void;
}

export function SettingsSection({
    section,
    values,
    fieldErrors,
    sources,
    overriddenKeys,
    pendingRestart,
    busyKeys,
    showAdvanced,
    onChange,
    onResetField,
    onResetSection,
}: SettingsSectionProps) {
    const m = useMessages();
    const sectionTitle = useSectionTitle();
    const sectionDescription = useSectionDescription();
    const hasOverride = section.fields.some((f) => overriddenKeys.has(f.key));
    const visibleFields = section.fields.filter((f) => isFieldVisible(f, showAdvanced));
    const description = sectionDescription(section.category);

    return (
        <section
            id={`section-${section.category}`}
            data-section-id={section.category}
            style={{ scrollMarginTop: SCROLL_OFFSET }}
        >
            <Sheet>
                <SheetHead
                    icon={section.icon}
                    title={sectionTitle(section.category, section.title)}
                    actions={
                        hasOverride ? (
                            <ConfirmPopover
                                trigger={
                                    <Button variant="ghost" size="sm">
                                        {m.settings_reset_section()}
                                    </Button>
                                }
                                body={m.settings_reset_section_body()}
                                confirmLabel={m.common_reset()}
                                danger
                                align="end"
                                onConfirm={() => onResetSection(section.category)}
                            />
                        ) : undefined
                    }
                />
                {description && (
                    <p className="border-muted/40 border-b px-[18px] py-2.5 text-muted-foreground text-xs">
                        {description}
                    </p>
                )}
                <div className="divide-y divide-muted/40 px-[18px]">
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
            </Sheet>
        </section>
    );
}
