import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getI18n } from "@/features/settings/api";
import { getLocale, isLocale, type Locale, setLocale as paraglideSetLocale } from "../generated/runtime";

interface LocaleContextValue {
    // locale is the concrete locale currently rendering the UI.
    locale: Locale;
    // refresh re-syncs the rendered locale to whatever the backend
    // resolved for `app.language`. Call it after a `POST /config/restart`
    // that may have changed `app.language`, so the UI catches up without
    // a page reload.
    refresh: () => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(() => getLocale());

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    const refresh = useCallback(async () => {
        const { data } = await getI18n();
        if (!data || !isLocale(data.locale)) return;
        if (data.locale === getLocale()) return;
        paraglideSetLocale(data.locale, { reload: false });
        setLocaleState(data.locale);
    }, []);

    // Backend is the source of truth for app.language. On mount, fetch
    // the resolved locale and reconcile — localStorage acts only as a
    // first-paint cache, so a stale cache (different machine, server-
    // side restart, env change) self-corrects without user action.
    useEffect(() => {
        void refresh();
    }, [refresh]);

    const value = useMemo(() => ({ locale, refresh }), [locale, refresh]);

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
    return ctx;
}
