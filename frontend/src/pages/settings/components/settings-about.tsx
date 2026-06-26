import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import LeapyOverlay from "@/components/series-leapy/leapy-overlay";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { type FieldSpec, SCROLL_OFFSET, SECTION_ICONS } from "@/features/settings";
import { type UpdateApiError, useUpdate } from "@/features/system";
import { useLocale, useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { CheckIcon, ExternalLinkIcon, SystemUpdateIcon } from "@/lib/icons";
import { ReleaseNotesDialog } from "./release-notes-dialog";
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
    const { locale } = useLocale();
    const resolveApiError = useApiErrorMessage();
    const { status, systemVersion, checking, applying, updateAvailable, checkNow, apply } = useUpdate();
    const [checkFailed, setCheckFailed] = useState(false);
    const [applyError, setApplyError] = useState<UpdateApiError | null>(null);

    const isDev = status?.is_dev ?? false;
    const currentVersion = status?.current_version ?? systemVersion?.version ?? "—";
    const latest = status?.latest_version ?? "";
    const lastChecked = status?.last_checked;
    const released = formatRelativeTime(status?.published_at, locale);
    const releasedLabel = released ? m.settings_about_released({ time: released }) : undefined;

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
        statusNode = <p className="m-0 text-muted-foreground">{m.settings_about_dev_build()}</p>;
    } else if (updateAvailable) {
        statusNode = (
            <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                {/* Headline */}
                <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <HugeiconsIcon icon={SystemUpdateIcon} size={12} strokeWidth={1.8} />
                    </span>
                    <p className="m-0 font-medium text-foreground text-sm">
                        {m.settings_about_update_available_title()}
                    </p>
                </div>

                {/* Version delta: current → new · released … */}
                <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
                    <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-medium font-mono text-primary">
                        {latest}
                    </span>
                    {releasedLabel && (
                        <>
                            <span className="font-bold">·</span>
                            <span className="text-muted-foreground">{releasedLabel}</span>
                        </>
                    )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={onApply} disabled={applying} size="sm">
                        {m.settings_about_apply()}
                    </Button>
                    {status?.release_notes && (
                        <ReleaseNotesDialog
                            version={latest}
                            notes={status.release_notes}
                            releasedLabel={releasedLabel}
                            releaseUrl={status.release_url ?? undefined}
                            applying={applying}
                            onApply={onApply}
                        />
                    )}
                    {status?.release_url && (
                        <a
                            href={status.release_url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto inline-flex items-center gap-1 self-center text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
                        >
                            <HugeiconsIcon icon={ExternalLinkIcon} size={12} strokeWidth={2} />
                            {m.settings_about_release_notes_view_github()}
                        </a>
                    )}
                </div>
                {applyError && <p className="m-0 text-destructive text-xs">{resolveApiError(applyError)}</p>}
            </div>
        );
    } else {
        statusNode = (
            <p className="m-0 flex items-center gap-1.5 text-muted-foreground">
                <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2} className="text-primary" />
                {m.settings_about_up_to_date()}
            </p>
        );
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
                <div className="space-y-3 px-[18px] py-4 text-sm">
                    {/* Version is the first item under About. */}
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{m.settings_about_version_label()}</span>
                        <span className="font-mono text-muted-foreground text-xs">{currentVersion}</span>
                    </div>

                    {systemVersion && (
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{m.settings_about_runtime_label()}</span>
                            <span className="font-mono text-muted-foreground text-xs">
                                {systemVersion.go_version} · {systemVersion.os}/{systemVersion.arch}
                            </span>
                        </div>
                    )}

                    {/* Authorship + open-source link — a static "Official" row that
                        sits directly under Runtime. */}
                    <div className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">{m.settings_about_official_label()}</span>
                        <div className="flex items-end gap-2 text-muted-foreground text-xs">
                            <a
                                href="https://github.com/txperl/PixivBiu"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 underline"
                            >
                                <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={2} />
                                {m.settings_about_open_source()}
                            </a>
                            <span>/</span>
                            {/* Authorship line is brand copy, intentionally not i18n'd. */}
                            <span>
                                Created by{" "}
                                <a
                                    href="https://github.com/txperl"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                >
                                    Trii Hsia
                                </a>{" "}
                                with ❤️
                            </span>
                        </div>
                    </div>
                    {statusNode && <div className="text-muted-foreground text-xs">{statusNode}</div>}
                    <div className="text-muted-foreground text-xs">
                        {checkFailed
                            ? m.settings_about_check_failed()
                            : lastChecked
                              ? m.settings_about_last_checked({ time: new Date(lastChecked).toLocaleString() })
                              : m.settings_about_never_checked()}
                    </div>
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
