import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from "react";
import { useLocation } from "react-router";
import { type SectionId, sectionDefaultUrl, sectionOf, stripTransientParams } from "@/app/sections";

type SectionUrls = Partial<Record<SectionId, string>>;

const SectionMemoryContext = createContext<SectionUrls>({});

/**
 * Remembers the last URL visited in each sidebar section (in memory, per session), so a
 * sidebar click returns to where that section was left — filters, page and all —
 * instead of its landing view. Key it by account so a session switch starts fresh.
 */
export function SectionMemoryProvider({
    selfUserId,
    children,
}: {
    selfUserId: number | null | undefined;
    children: ReactNode;
}) {
    const location = useLocation();
    const [urls, setUrls] = useState<SectionUrls>({});

    useLayoutEffect(() => {
        const section = sectionOf(location, selfUserId);
        if (section == null) return;
        const url = stripTransientParams(location);
        setUrls((prev) => (prev[section] === url ? prev : { ...prev, [section]: url }));
    }, [location, selfUserId]);

    return <SectionMemoryContext value={urls}>{children}</SectionMemoryContext>;
}

/** Where a sidebar item should link: the section's last URL, else its landing view. */
export function useSectionUrl(id: SectionId, selfUserId: number | null | undefined): string | null {
    const urls = useContext(SectionMemoryContext);
    return urls[id] ?? sectionDefaultUrl(id, selfUserId);
}
