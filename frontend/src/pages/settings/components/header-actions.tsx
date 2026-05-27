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
import { useMessages } from "@/i18n";

// Full error in a popover; the bar keeps just the icon so nothing is truncated.
// Keyed on the message so a fresh error remounts and opens on its own for
// immediate feedback. Only reached in the save state (dirtyCount > 0), so the
// "save failed" title always holds — reset errors sit at zero dirty and never arrive here.
function SaveErrorPopover({ message }: { message: string }) {
    const m = useMessages();
    const [open, setOpen] = useState(true);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={m.settings_save_error_aria()}
                        className="text-destructive"
                    >
                        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                    </Button>
                }
            />
            <PopoverContent className="w-80 gap-1">
                <PopoverHeader>
                    <PopoverTitle className="text-destructive">{m.settings_save_error_title()}</PopoverTitle>
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
    const m = useMessages();
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
                        {m.settings_discard()}
                    </Button>
                    <Button size="sm" onClick={onSave} disabled={saving || dirtyCount === 0}>
                        {saving ? m.settings_saving() : m.settings_save_count({ count: dirtyCount })}
                    </Button>
                </>
            ) : (
                <ConfirmPopover
                    trigger={
                        <Button size="sm" disabled={restarting}>
                            {restarting
                                ? m.settings_restarting()
                                : m.settings_restart_count({ count: pendingKeys.length })}
                        </Button>
                    }
                    body={m.settings_restart_body()}
                    confirmLabel={m.settings_restart_confirm()}
                    danger
                    side="bottom"
                    align="end"
                    onConfirm={onRestart}
                />
            )}
        </div>
    );
}
