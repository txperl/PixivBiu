import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import LeapyOverlay from "@/components/series-leapy/leapy-overlay";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import {
    isFieldVisible,
    NAV_TOP,
    NamingValuesProvider,
    restartConfig,
    SECTION_ICONS,
    type SectionSpec,
    type SettingsSaveState,
    settingsSaveState,
    useConfig,
    useConfigForm,
    useScrollSpy,
} from "@/features/settings";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { APP_SCROLLER_SELECTOR } from "@/lib/scroll";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { cn } from "@/lib/utils";
import { SettingsHeaderActions } from "./components/header-actions";
import { ABOUT_ID, SettingsAbout } from "./components/settings-about";
import { SettingsNav } from "./components/settings-nav";
import { SettingsSection } from "./components/settings-section";

// Tints the whole fixed bar by state, so the frame signals unsaved / needs-restart at a glance.
const HEADER_TINT: Record<SettingsSaveState, string> = {
    save: "bg-secondary/85",
    restart: "bg-accent/85",
    none: "bg-background/85",
};

function SettingsPage() {
    const m = useMessages();
    const resolveApiError = useApiErrorMessage();
    const { loadState, sections, view, setView, awaitRestart, schemaMismatch } = useConfig();
    const form = useConfigForm({ view, sections, onView: setView });
    // Defer the loading text so a fast config fetch (localhost) never flashes it.
    const showLoading = useDelayedFlag(loadState.status === "loading");

    const rootRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    // The scroll container is the layout's ScrollArea viewport ([data-app-scroller]), not <main> or the window.
    useLayoutEffect(() => {
        scrollerRef.current = rootRef.current?.closest<HTMLElement>(APP_SCROLLER_SELECTOR) ?? null;
    }, []);

    const [showAdvanced, setShowAdvanced] = useState(false);

    // Sections with nothing to show under the current toggle are dropped
    // entirely (e.g. the all-advanced "system" section when advanced is off),
    // so the nav, scroll-spy, and content stay in sync and free of empty cards.
    // The `about` category is excluded here: its fields (the update settings)
    // render inside the custom About card, which is always shown regardless of
    // the advanced toggle, so it must not also appear as a normal section.
    const visibleSections = useMemo(
        () => sections.filter((s) => s.category !== ABOUT_ID && s.fields.some((f) => isFieldVisible(f, showAdvanced))),
        [sections, showAdvanced],
    );

    // The update settings carry category `about`, so the form owns them
    // (values/dirty/overridden/reset). The About card renders them itself.
    const aboutFields = useMemo(() => sections.find((s) => s.category === ABOUT_ID)?.fields ?? [], [sections]);

    // The About card is a synthetic section pinned first in the nav/scroll-spy.
    const navSections = useMemo<SectionSpec[]>(
        () => [{ category: ABOUT_ID, icon: SECTION_ICONS.about, fields: [] }, ...visibleSections],
        [visibleSections],
    );

    const sectionIds = useMemo(() => navSections.map((s) => s.category), [navSections]);
    const { activeId, scrollTo } = useScrollSpy(scrollerRef, sectionIds);
    const currentActive = activeId ?? navSections[0]?.category;

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
                {loadState.status === "loading" && showLoading && (
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
                                <SettingsNav sections={navSections} activeId={currentActive} onSelect={scrollTo} />
                            </aside>

                            <NamingValuesProvider values={form.values}>
                                <div className="min-w-0 space-y-5">
                                    <SettingsAbout
                                        fields={aboutFields}
                                        values={form.values}
                                        fieldErrors={form.fieldErrors}
                                        sources={view.sources}
                                        overriddenKeys={form.overriddenKeys}
                                        pendingRestart={pendingSet}
                                        busyKeys={form.busyKeys}
                                        showAdvanced={showAdvanced}
                                        onChange={form.setValue}
                                        onResetField={form.resetField}
                                    />
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

            {restarting && <LeapyOverlay label={m.settings_restart_overlay()} />}
        </div>
    );
}

export default SettingsPage;
