import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import { SCROLL_OFFSET, type SectionSpec, useSectionDescription, useSectionTitle } from "@/features/settings";
import { useMessages } from "@/i18n";
import { type FieldRowProps, SettingsFieldList } from "./settings-field-list";

interface SettingsSectionProps extends FieldRowProps {
    section: SectionSpec;
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
                    title={sectionTitle(section.category)}
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
                <SettingsFieldList
                    fields={section.fields}
                    values={values}
                    fieldErrors={fieldErrors}
                    sources={sources}
                    overriddenKeys={overriddenKeys}
                    pendingRestart={pendingRestart}
                    busyKeys={busyKeys}
                    showAdvanced={showAdvanced}
                    onChange={onChange}
                    onResetField={onResetField}
                />
            </Sheet>
        </section>
    );
}
