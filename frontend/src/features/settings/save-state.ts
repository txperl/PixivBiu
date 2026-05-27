export type SettingsSaveState = "save" | "restart" | "none";

// The top bar's tint and its action cluster share this single resolver so they
// can't disagree. Only unsaved edits drive "save" — a save error rides along
// inside that state (it stays attached to the still-pending edits), so once
// they're saved or reverted there's nothing dead to act on. The restart prompt
// surfaces once everything is saved.
export function settingsSaveState(dirtyCount: number, pendingCount: number): SettingsSaveState {
    if (dirtyCount > 0) return "save";
    if (pendingCount > 0) return "restart";
    return "none";
}
