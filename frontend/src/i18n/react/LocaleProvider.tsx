import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocale, type Locale, setLocale as paraglideSetLocale } from "../generated/runtime";

interface LocaleContextValue {
    locale: Locale;
    setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(() => getLocale());

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    const setLocale = useCallback((next: Locale) => {
        // reload:false keeps the SPA mounted; Paraglide strategies still persist the choice.
        paraglideSetLocale(next, { reload: false });
        setLocaleState(next);
    }, []);

    const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
    return ctx;
}
