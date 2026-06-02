import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { type ReactNode, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { SCROLL_OFFSET } from "@/features/settings";
import { type UpdateApiError, useUpdate } from "@/features/system";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";

// Section id for the About card; shared with the settings page so the nav and
// scroll-spy (which key off data-section-id) treat it like a real section.
export const ABOUT_ID = "about";

function UpdatingOverlay({ label }: { label: string }) {
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur">
            <LeapyLoading size={20} />
            <span className="text-muted-foreground text-sm">{label}</span>
        </div>
    );
}

// SettingsAbout is a custom (non-schema) settings card: it shows the running
// version + build info and drives the one-click update flow. It participates
// in the settings nav / scroll-spy via the shared data-section-id contract.
export function SettingsAbout() {
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
                    icon={InformationCircleIcon}
                    title={m.settings_about_title()}
                    meta={currentVersion}
                    actions={
                        <Button variant="outline" size="sm" onClick={onCheck} disabled={checking}>
                            {checking ? m.settings_about_checking() : m.settings_about_check_now()}
                        </Button>
                    }
                />
                <div className="space-y-4 px-[18px] py-4 text-sm">
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
            </Sheet>
            {applying && <UpdatingOverlay label={m.settings_about_updating()} />}
        </section>
    );
}
