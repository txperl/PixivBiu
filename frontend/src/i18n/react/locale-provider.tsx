import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ConfigView } from "@/features/settings/api";
import { getConfig } from "@/features/settings/api";
import { nestedGet } from "@/features/settings/flatten";
import { getLocale, isLocale, type Locale, setLocale as paraglideSetLocale } from "../generated/runtime";

interface LocaleContextValue {
    // locale is the concrete locale currently rendering the UI.
    locale: Locale;
    // applyLanguage re-resolves the UI locale from a raw `app.language`
    // value (`auto`/`en`/`zh-CN`/`ja`).
    applyLanguage: (configured: string) => void;
    // applyLanguageFromView extracts `app.language` from a ConfigView and
    // applies it. Used by the Settings form after PATCH/RESET and by the
    // post-auth bridge that re-syncs once `/config` becomes reachable.
    applyLanguageFromView: (view: ConfigView) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Paraglide's localStorage key (see node_modules/@inlang/paraglide-js
// runtime/variables.js). We read it directly to tell "user has chosen
// before" from "first visit ever".
const PARAGLIDE_LOCALE_KEY = "PARAGLIDE_LOCALE";

// HAS_PARAGLIDE_CACHE must be captured at module load — *before* any
// getLocale() call gets a chance to seed the cache. Paraglide's
// get-locale.js memoises the first-resolve result by calling
// setLocale(..., { reload: false }) on it, and the localStorage strategy
// in set-locale.js then writes PARAGLIDE_LOCALE. If we deferred this read
// to the mount effect (or even the useState initializer), the key would
// already be populated and we'd never detect a true first visit.
const HAS_PARAGLIDE_CACHE: boolean =
    typeof window !== "undefined" &&
    typeof localStorage !== "undefined" &&
    !!localStorage.getItem(PARAGLIDE_LOCALE_KEY);

// resolveFromNavigator walks navigator.languages in priority order and
// prefix-matches each entry to one of our locales. Paraglide's
// extractLocaleFromNavigator can't be used here: it only succeeds when the
// nav tag (or its base) is *exactly* one of the configured locales — and
// since our project locale is "zh-CN" (not "zh"), it returns undefined for
// the common Chinese tags `zh`, `zh-Hans-CN`, `zh-TW`.
function resolveFromNavigator(): Locale {
    if (typeof navigator === "undefined") return "en";
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
        const lower = (lang ?? "").toLowerCase();
        if (lower.startsWith("zh")) return "zh-CN";
        if (lower.startsWith("ja")) return "ja";
        if (lower.startsWith("en")) return "en";
    }
    return "en";
}

// resolveLocale maps a configured `app.language` value to a concrete Locale.
// `auto`/empty delegates to navigator-priority matching; explicit values are
// validated and fall back to en when unrecognised.
function resolveLocale(configured: string): Locale {
    if (configured === "auto" || configured === "") return resolveFromNavigator();
    return isLocale(configured) ? configured : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(() => getLocale());

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    const applyLanguage = useCallback((configured: string) => {
        const next = resolveLocale(configured);
        if (next === getLocale()) return;
        paraglideSetLocale(next, { reload: false });
        setLocaleState(next);
    }, []);

    const applyLanguageFromView = useCallback(
        (view: ConfigView) => {
            const configured = nestedGet(view.effective, "app.language");
            if (typeof configured === "string") applyLanguage(configured);
        },
        [applyLanguage],
    );

    // First-paint default. When Paraglide had no localStorage cache at
    // module load (true first visit), we resolve `auto` against the
    // navigator so the login page lands in the user's language before any
    // API call. On subsequent visits the cache wins, preserving an
    // explicit prior choice. The backend's persisted `app.language` is
    // applied later by <LocaleSync> once auth makes `/config` reachable.
    useEffect(() => {
        if (!HAS_PARAGLIDE_CACHE) {
            applyLanguage("auto");
        }
    }, [applyLanguage]);

    const value = useMemo(
        () => ({ locale, applyLanguage, applyLanguageFromView }),
        [locale, applyLanguage, applyLanguageFromView],
    );

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
    return ctx;
}

// LocaleSync re-fetches `/config` whenever auth status transitions to
// authenticated, so the persisted `app.language` is applied as soon as the
// endpoint becomes reachable (initial login, post-restart reconnect,
// recovery after a logout/login cycle). Must be mounted inside both
// LocaleProvider and AuthProvider; pass `authenticated` from the outer
// AuthProvider, which sits below LocaleProvider in the tree.
export function LocaleSync({ authenticated }: { authenticated: boolean }) {
    const { applyLanguageFromView } = useLocale();
    useEffect(() => {
        if (!authenticated) return;
        void getConfig().then(({ data }) => {
            if (data) applyLanguageFromView(data);
        });
    }, [authenticated, applyLanguageFromView]);
    return null;
}
