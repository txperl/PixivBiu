import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import {
    isFieldVisible,
    NAV_TOP,
    NamingValuesProvider,
    restartConfig,
    type SettingsSaveState,
    settingsSaveState,
    useConfig,
    useConfigForm,
    useScrollSpy,
} from "@/features/settings";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SettingsHeaderActions } from "./components/header-actions";
import { SettingsNav } from "./components/settings-nav";
import { SettingsSection } from "./components/settings-section";

// Tints the whole fixed bar by state, so the frame signals unsaved / needs-restart at a glance.
const HEADER_TINT: Record<SettingsSaveState, string> = {
    save: "bg-secondary/85",
    restart: "bg-accent/85",
    none: "bg-background/85",
};

function RestartOverlay() {
    const m = useMessages();
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur">
            <LeapyLoading size={20} />
            <span className="text-muted-foreground text-sm">{m.settings_restart_overlay()}</span>
        </div>
    );
}

function SettingsPage() {
    const m = useMessages();
    const resolveApiError = useApiErrorMessage();
    const { loadState, sections, view, setView, awaitRestart, schemaMismatch } = useConfig();
    const form = useConfigForm({ view, sections, onView: setView });

    const rootRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    // The scroll container is the layout's <main>, not the window.
    useLayoutEffect(() => {
        scrollerRef.current = rootRef.current?.closest("main") ?? null;
    }, []);

    const [showAdvanced, setShowAdvanced] = useState(false);

    // Sections with nothing to show under the current toggle are dropped
    // entirely (e.g. the all-internal "server" section when advanced is off),
    // so the nav, scroll-spy, and content stay in sync and free of empty cards.
    const visibleSections = useMemo(
        () => sections.filter((s) => s.fields.some((f) => isFieldVisible(f, showAdvanced))),
        [sections, showAdvanced],
    );

    const sectionIds = useMemo(() => visibleSections.map((s) => s.category), [visibleSections]);
    const { activeId, scrollTo } = useScrollSpy(scrollerRef, sectionIds);
    const currentActive = activeId ?? visibleSections[0]?.category;

    const pendingKeys = view?.pending_restart ?? [];
    const pendingSet = useMemo(() => new Set(pendingKeys), [pendingKeys]);
    const hasOverrides = form.overriddenKeys.size > 0;
    const headerState = settingsSaveState(form.dirtyKeys.length, pendingKeys.length);

    const [restarting, setRestarting] = useState(false);
    const onRestart = useCallback(async () => {
        const keys = view?.pending_restart ?? [];
        setRestarting(true);
        const { error } = await restartConfig();
        if (error) {
            setRestarting(false);
            return;
        }
        // The 202 is in, so the confirm popover closes immediately; the overlay
        // covers the drain/reconnect while we poll in the background and drop it
        // once the new process answers. server.host/port are internal now, so a
        // restart never moves the backend to a different origin.
        void awaitRestart(keys).finally(() => setRestarting(false));
    }, [view, awaitRestart]);

    return (
        <div ref={rootRef} className="flex flex-col">
            {/* The page's single fixed frame: title, advanced toggle, reset-all,
                and the save/restart state all live here, so nothing floats. */}
            <header
                className={cn(
                    "sticky top-0 z-20 flex h-16 items-center gap-3 border-border border-b px-7 backdrop-blur transition-colors",
                    HEADER_TINT[headerState],
                )}
            >
                <h1 className="font-semibold text-2xl text-foreground">{m.settings_title()}</h1>
                <div className="flex-1" />
                {loadState.status === "success" && (
                    <>
                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <span>{m.settings_advanced_label()}</span>
                            <Switch
                                checked={showAdvanced}
                                aria-label={m.settings_advanced_aria()}
                                onCheckedChange={(c) => setShowAdvanced(c)}
                            />
                        </div>
                        {hasOverrides && (
                            <ConfirmPopover
                                trigger={
                                    <Button variant="ghost" size="sm">
                                        {m.settings_reset_all()}
                                    </Button>
                                }
                                body={m.settings_reset_all_body()}
                                confirmLabel={m.settings_reset_all()}
                                danger
                                align="end"
                                onConfirm={form.resetAll}
                            />
                        )}
                        <SettingsHeaderActions
                            dirtyCount={form.dirtyKeys.length}
                            saving={form.saving}
                            error={form.generalError}
                            onSave={form.save}
                            onDiscard={form.discard}
                            pendingKeys={pendingKeys}
                            restarting={restarting}
                            onRestart={onRestart}
                        />
                    </>
                )}
            </header>

            <div className="px-7 pt-6 pb-7">
                {loadState.status === "loading" && (
                    <div className="py-24 text-center text-muted-foreground text-sm">{m.settings_loading()}</div>
                )}

                {loadState.status === "error" && (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm">
                        {m.settings_load_error({ message: resolveApiError(loadState.error) })}
                    </div>
                )}

                {loadState.status === "success" && view && (
                    <div className="space-y-6">
                        {schemaMismatch && (
                            <div className="flex items-center gap-2 rounded-2xl border border-border bg-accent px-4 py-3 text-accent-foreground text-sm">
                                <HugeiconsIcon icon={Alert02Icon} size={18} />
                                {m.settings_schema_mismatch()}
                            </div>
                        )}

                        <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8">
                            <aside className="sticky self-start" style={{ top: NAV_TOP }}>
                                <SettingsNav sections={visibleSections} activeId={currentActive} onSelect={scrollTo} />
                            </aside>

                            <NamingValuesProvider values={form.values}>
                                <div className="min-w-0 space-y-5">
                                    {visibleSections.map((section) => (
                                        <SettingsSection
                                            key={section.category}
                                            section={section}
                                            values={form.values}
                                            fieldErrors={form.fieldErrors}
                                            sources={view.sources}
                                            overriddenKeys={form.overriddenKeys}
                                            pendingRestart={pendingSet}
                                            busyKeys={form.busyKeys}
                                            showAdvanced={showAdvanced}
                                            onChange={form.setValue}
                                            onResetField={form.resetField}
                                            onResetSection={form.resetSection}
                                        />
                                    ))}
                                </div>
                            </NamingValuesProvider>
                        </div>
                    </div>
                )}
            </div>

            {restarting && <RestartOverlay />}
        </div>
    );
}

export default SettingsPage;
