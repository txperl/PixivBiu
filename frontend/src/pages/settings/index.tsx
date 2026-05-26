import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import { type ConfigView, nestedGet, restartConfig, useConfig, useConfigForm, useScrollSpy } from "@/features/settings";
import { apiErrorMessage } from "@/lib/api";
import { ActionBar } from "./components/action-bar";
import { SettingsNav } from "./components/settings-nav";
import { SettingsSection } from "./components/settings-section";

// Wildcard bind addresses aren't navigable, so we can't build a URL from them.
function isWildcardHost(host: unknown): boolean {
    return host == null || host === "" || host === "0.0.0.0" || host === "::";
}

// Best-effort URL the backend will live at after a pending host/port change.
// Pulls the new host/port from the file layer; falls back to the address the
// user is already on for wildcard hosts / unchanged port.
function restartTargetUrl(view: ConfigView): string {
    const loc = window.location;
    const fileHost = nestedGet(view.file, "server.host");
    const filePort = nestedGet(view.file, "server.port");
    const hostname = isWildcardHost(fileHost) ? loc.hostname : String(fileHost);
    const port = filePort != null ? String(filePort) : loc.port;
    return `${loc.protocol}//${hostname}${port ? `:${port}` : ""}${loc.pathname}${loc.search}${loc.hash}`;
}

function RestartOverlay({ movedUrl }: { movedUrl: string | null }) {
    if (movedUrl) {
        return (
            <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 px-6 text-center backdrop-blur">
                <span className="max-w-md text-foreground text-sm">
                    服务器监听地址已更改，无法自动恢复。重启完成后请访问新地址：
                </span>
                <a href={movedUrl} className="font-medium text-primary text-sm underline underline-offset-4">
                    {movedUrl}
                </a>
            </div>
        );
    }
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

    const sectionIds = useMemo(() => sections.map((s) => s.category), [sections]);
    const { activeId, scrollTo } = useScrollSpy(scrollerRef, sectionIds);
    const currentActive = activeId ?? sections[0]?.category;

    const pendingKeys = view?.pending_restart ?? [];
    const pendingSet = useMemo(() => new Set(pendingKeys), [pendingKeys]);
    const hasOverrides = form.overriddenKeys.size > 0;

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [movedUrl, setMovedUrl] = useState<string | null>(null);
    const onRestart = useCallback(async () => {
        const keys = view?.pending_restart ?? [];
        const addressChange = keys.includes("server.host") || keys.includes("server.port");
        setRestarting(true);
        const { error } = await restartConfig();
        if (error) {
            setRestarting(false);
            return;
        }
        // A host/port change brings the backend back on a different origin, which
        // same-origin polling can't reach. Surface the new address instead of
        // falsely waiting for recovery here.
        if (view && addressChange) {
            const target = restartTargetUrl(view);
            if (new URL(target).origin !== window.location.origin) {
                setMovedUrl(target);
                return;
            }
        }
        // Otherwise return now (the 202 is in) so the confirm popover closes
        // immediately; the overlay covers the drain/reconnect while we poll in
        // the background and drop it once the new process answers.
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
                        body="将所有设置恢复为默认值（不影响环境变量覆盖）。"
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
                            <SettingsNav sections={sections} activeId={currentActive} onSelect={scrollTo} />
                        </aside>

                        <div className="min-w-0">
                            <div className="space-y-5">
                                {sections.map((section) => (
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

            {(restarting || movedUrl) && <RestartOverlay movedUrl={movedUrl} />}
        </div>
    );
}

export default SettingsPage;
