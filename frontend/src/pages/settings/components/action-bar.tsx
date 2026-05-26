import { Button } from "@/components/ui/button";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";

interface ActionBarProps {
    dirtyCount: number;
    saving: boolean;
    error?: string;
    onSave: () => void;
    onDiscard: () => void;
    pendingKeys: string[];
    restarting: boolean;
    onRestart: () => void;
}

const shell = "sticky bottom-4 z-10 mt-6 flex items-center gap-3 rounded-lg py-2 pr-2 pl-4 shadow-lg backdrop-blur";

// One sticky bottom panel that serves both unsaved-changes and
// pending-restart states. Unsaved changes take priority: the restart prompt
// only surfaces once everything is saved, so the next action is always the
// most relevant one and lives in the same easy-to-spot place.
export function ActionBar({
    dirtyCount,
    saving,
    error,
    onSave,
    onDiscard,
    pendingKeys,
    restarting,
    onRestart,
}: ActionBarProps) {
    const showSave = dirtyCount > 0 || !!error;
    const showRestart = !showSave && pendingKeys.length > 0;
    if (!showSave && !showRestart) return null;

    if (showSave) {
        return (
            <div className={`${shell} border border-border bg-secondary/95`}>
                <span className="font-medium text-secondary-foreground text-sm">
                    {dirtyCount > 0 ? `${dirtyCount} 项未保存` : "保存失败"}
                </span>
                {error && <span className="truncate text-destructive text-xs">{error}</span>}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving || dirtyCount === 0}>
                    放弃更改
                </Button>
                <Button size="sm" onClick={onSave} disabled={saving || dirtyCount === 0}>
                    {saving ? "保存中…" : "保存"}
                </Button>
            </div>
        );
    }

    return (
        <div className={`${shell} border border-border bg-accent/95`}>
            <span className="min-w-0 truncate font-medium text-accent-foreground text-sm">
                {pendingKeys.length} 项更改需重启后生效
            </span>
            <div className="flex-1" />
            <ConfirmPopover
                trigger={
                    <Button size="sm" disabled={restarting}>
                        {restarting ? "正在重启…" : "立即重启"}
                    </Button>
                }
                body="将重启后端进程以应用这些设置，连接会短暂断开并自动恢复。"
                confirmLabel="重启"
                danger
                side="top"
                align="end"
                onConfirm={onRestart}
            />
        </div>
    );
}
