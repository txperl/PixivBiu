import { type ReactNode, useState } from "react";
import LeapyOverlay from "@/components/series-leapy/leapy-overlay";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { type FieldSpec, SCROLL_OFFSET, SECTION_ICONS } from "@/features/settings";
import { type UpdateApiError, useUpdate } from "@/features/system";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { type FieldRowProps, SettingsFieldList } from "./settings-field-list";

// Section id for the About card; shared with the settings page so the nav and
// scroll-spy (which key off data-section-id) treat it like a real section.
export const ABOUT_ID = "about";

interface SettingsAboutProps extends FieldRowProps {
    // The `about`-category schema fields (the update settings). They live in the
    // form like any other field; the About card renders them here instead of as
    // a normal section, gated by the advanced toggle.
    fields: FieldSpec[];
}

// SettingsAbout is a custom (non-schema) settings card: it shows the running
// version + build info and drives the one-click update flow. It participates
// in the settings nav / scroll-spy via the shared data-section-id contract.
export function SettingsAbout({
    fields,
    values,
    fieldErrors,
    sources,
    overriddenKeys,
    pendingRestart,
    busyKeys,
    showAdvanced,
    onChange,
    onResetField,
}: SettingsAboutProps) {
    const m = useMessages();
    const resolveApiError = useApiErrorMessage();
    const { status, systemVersion, checking, applying, updateAvailable, checkNow, apply } = useUpdate();
    const [checkFailed, setCheckFailed] = useState(false);
    const [applyError, setApplyError] = useState<UpdateApiError | null>(null);

    const isDev = status?.is_dev ?? false;
    const currentVersion = status?.current_version ?? systemVersion?.version ?? "—";
    const latest = status?.latest_version ?? "";
    const lastChecked = status?.last_checked;

    const onCheck = async () => {
        setCheckFailed(false);
        const err = await checkNow();
        setCheckFailed(!!err);
    };
    const onApply = async () => {
        setApplyError(null);
        const err = await apply();
        if (err) setApplyError(err);
    };

    // Precomputed to avoid a nested ternary in JSX.
    let statusNode: ReactNode;
    if (isDev) {
        statusNode = <p className="text-muted-foreground">{m.settings_about_dev_build()}</p>;
    } else if (updateAvailable) {
        statusNode = (
            <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="font-medium text-foreground">{m.settings_about_update_available({ version: latest })}</p>
                <div className="flex items-center gap-3">
                    <Button onClick={onApply} disabled={applying}>
                        {m.settings_about_apply()}
                    </Button>
                    {status?.release_url && (
                        <a
                            href={status.release_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
                        >
                            {m.settings_about_release_notes()}
                        </a>
                    )}
                </div>
                {applyError && <p className="text-destructive text-xs">{resolveApiError(applyError)}</p>}
            </div>
        );
    } else {
        statusNode = <p className="text-muted-foreground">{m.settings_about_up_to_date()}</p>;
    }

    return (
        <section id={`section-${ABOUT_ID}`} data-section-id={ABOUT_ID} style={{ scrollMarginTop: SCROLL_OFFSET }}>
            <Sheet>
                <SheetHead
                    icon={SECTION_ICONS.about}
                    title={m.settings_about_title()}
                    actions={
                        <Button variant="outline" size="sm" onClick={onCheck} disabled={checking}>
                            {checking ? m.settings_about_checking() : m.settings_about_check_now()}
                        </Button>
                    }
                />
                <div className="space-y-4 px-[18px] py-4 text-sm">
                    {/* Version is the first item under About. */}
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{m.settings_about_version_label()}</span>
                        <span className="font-mono text-foreground">{currentVersion}</span>
                    </div>

                    {systemVersion && (
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{m.settings_about_runtime_label()}</span>
                            <span className="font-mono text-muted-foreground text-xs">
                                {systemVersion.go_version} · {systemVersion.os}/{systemVersion.arch}
                            </span>
                        </div>
                    )}

                    {statusNode}

                    <p className="text-muted-foreground text-xs">
                        {checkFailed
                            ? m.settings_about_check_failed()
                            : lastChecked
                              ? m.settings_about_last_checked({ time: new Date(lastChecked).toLocaleString() })
                              : m.settings_about_never_checked()}
                    </p>
                </div>

                {/* Update settings (enabled / channel) — advanced tier, so they
                    only surface with the advanced toggle on. They render with the
                    same field rows as any other section. */}
                <SettingsFieldList
                    fields={fields}
                    className="border-muted/40 border-t"
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
            {applying && <LeapyOverlay label={m.settings_about_updating()} />}
        </section>
    );
}
