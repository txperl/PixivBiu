import type {} from "./desktop";

// Mirror the shell's explicit allowlist. localStorage remains the synchronous
// working copy (and the persistent store in browsers); desktop hydrates it
// before importing App so module-level readers and Paraglide see saved values.
const KEYS = [
    "PARAGLIDE_LOCALE",
    "pixivbiu.general-filters",
    "pixivbiu.search.history.v1",
    "pixivbiu.activity-bar",
] as const;

export async function restoreDesktopPreferences(): Promise<void> {
    const bridge = window.pixivbiu;
    if (!bridge) return;
    try {
        const values = await bridge.preferences.read();
        for (const key of KEYS) {
            const value = values[key];
            if (typeof value === "string") window.localStorage.setItem(key, value);
        }
    } catch {
        console.warn("Could not restore desktop UI preferences");
    }
}

export function writePreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Browser privacy policy or quota can make localStorage unavailable.
    }
    const bridge = window.pixivbiu;
    if (bridge) {
        void bridge.preferences.write(key, value).catch(() => {
            console.warn("Could not save desktop UI preference");
        });
    }
}
