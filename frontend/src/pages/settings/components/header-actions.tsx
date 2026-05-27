import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from "@/components/ui/popover";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import { settingsSaveState } from "@/features/settings";

// Full error in a popover; the bar keeps just the icon so nothing is truncated.
// Keyed on the message so a fresh error remounts and opens on its own for
// immediate feedback. Only reached in the save state (dirtyCount > 0), so the
// "保存失败" title always holds — reset errors sit at zero dirty and never arrive here.
function SaveErrorPopover({ message }: { message: string }) {
    const [open, setOpen] = useState(true);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="查看保存错误"
                        className="text-destructive"
                    >
                        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                    </Button>
                }
            />
            <PopoverContent className="w-80 gap-1">
                <PopoverHeader>
                    <PopoverTitle className="text-destructive">保存失败</PopoverTitle>
                </PopoverHeader>
                <PopoverDescription className="wrap-break-word whitespace-pre-wrap text-foreground text-xs">
                    {message}
                </PopoverDescription>
            </PopoverContent>
        </Popover>
    );
}

interface SettingsHeaderActionsProps {
    dirtyCount: number;
    saving: boolean;
    error?: string;
    onSave: () => void;
    onDiscard: () => void;
    pendingKeys: string[];
    restarting: boolean;
    onRestart: () => void;
}

// The save/restart state lives inline in the fixed top bar so the page has a
// single anchored frame and nothing floats.
export function SettingsHeaderActions({
    dirtyCount,
    saving,
    error,
    onSave,
    onDiscard,
    pendingKeys,
    restarting,
    onRestart,
}: SettingsHeaderActionsProps) {
    const state = settingsSaveState(dirtyCount, pendingKeys.length);
    if (state === "none") return null;

    return (
        // A leading divider keeps the transient save state visually separate
        // from the always-present controls (advanced toggle, reset all).
        <div className="flex items-center gap-2">
            <span className="h-5 w-px bg-border" aria-hidden />
            {state === "save" ? (
                <>
                    {error && <SaveErrorPopover key={error} message={error} />}
                    <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving || dirtyCount === 0}>
                        放弃更改
                    </Button>
                    <Button size="sm" onClick={onSave} disabled={saving || dirtyCount === 0}>
                        {saving ? "保存中…" : `保存 ( ${dirtyCount} 项 )`}
                    </Button>
                </>
            ) : (
                <ConfirmPopover
                    trigger={
                        <Button size="sm" disabled={restarting}>
                            {restarting ? "正在重启…" : `立即重启 ( ${pendingKeys.length} 项)`}
                        </Button>
                    }
                    body="将重启后端进程以应用这些设置，连接会短暂断开并自动恢复。"
                    confirmLabel="重启"
                    danger
                    side="bottom"
                    align="end"
                    onConfirm={onRestart}
                />
            )}
        </div>
    );
}
