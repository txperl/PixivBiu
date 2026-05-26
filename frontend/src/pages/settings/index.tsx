import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import { isFieldVisible, restartConfig, useConfig, useConfigForm, useScrollSpy } from "@/features/settings";
import { apiErrorMessage } from "@/lib/api";
import { ActionBar } from "./components/action-bar";
import { SettingsNav } from "./components/settings-nav";
import { SettingsSection } from "./components/settings-section";

function RestartOverlay() {
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur">
            <LeapyLoading size={20} />
            <span className="text-muted-foreground text-sm">正在重启后端，稍候将自动恢复…</span>
        </div>
    );
}

function SettingsPage() {
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
        <div ref={rootRef} className="px-7 pt-7 pb-7">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="font-semibold text-5xl text-foreground">设置</h1>
                <div className="flex-1" />
                {loadState.status === "success" && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                        <span>高级选项</span>
                        <Switch
                            checked={showAdvanced}
                            aria-label="显示高级选项"
                            onCheckedChange={(c) => setShowAdvanced(c)}
                        />
                    </div>
                )}
                {hasOverrides && (
                    <ConfirmPopover
                        trigger={
                            <Button variant="ghost" size="sm">
                                全部重置
                            </Button>
                        }
                        body="将所有设置恢复为默认值（不影响环境变量与运维设置）。"
                        confirmLabel="全部重置"
                        danger
                        align="end"
                        onConfirm={form.resetAll}
                    />
                )}
            </header>

            {loadState.status === "loading" && (
                <div className="py-24 text-center text-muted-foreground text-sm">加载中…</div>
            )}

            {loadState.status === "error" && (
                <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm">
                    加载设置失败：{apiErrorMessage(loadState.error)}
                </div>
            )}

            {loadState.status === "success" && view && (
                <>
                    {schemaMismatch && (
                        <div className="mt-6 flex items-center gap-2 rounded-2xl border border-border bg-accent px-4 py-3 text-accent-foreground text-sm">
                            <HugeiconsIcon icon={Alert02Icon} size={18} />
                            配置结构版本与前端不一致，部分项可能无法正确显示，建议更新后重试。
                        </div>
                    )}

                    <div className="mt-6 grid grid-cols-[200px_minmax(0,1fr)] gap-8">
                        <aside className="sticky top-6 self-start">
                            <SettingsNav sections={visibleSections} activeId={currentActive} onSelect={scrollTo} />
                        </aside>

                        <div className="min-w-0">
                            <div className="space-y-5">
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

                            <ActionBar
                                dirtyCount={form.dirtyKeys.length}
                                saving={form.saving}
                                error={form.generalError}
                                onSave={form.save}
                                onDiscard={form.discard}
                                pendingKeys={pendingKeys}
                                restarting={restarting}
                                onRestart={onRestart}
                            />
                        </div>
                    </div>
                </>
            )}

            {restarting && <RestartOverlay />}
        </div>
    );
}

export default SettingsPage;
