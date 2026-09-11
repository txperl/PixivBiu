import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { WindowContentBoundary } from "@/lib/window-layout";

export default function WindowLayout({ children }: { children: ReactNode }) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [boundary, setBoundary] = useState<DOMRect>();

    useLayoutEffect(() => {
        const platform = window.pixivbiu?.platform;
        const content = contentRef.current;
        if (!content || platform?.os !== "win32" || !platform.frameless) return;
        const measure = () => setBoundary(content.getBoundingClientRect());
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        measure();
        return () => observer.disconnect();
    }, []);

    return (
        <WindowContentBoundary value={boundary}>
            <div className="flex h-svh flex-col overflow-hidden">
                <div className="window-titlebar shrink-0 bg-background frost:bg-sidebar" aria-hidden="true">
                    <div className="window-titlebar-safe app-drag flex items-center overflow-hidden px-4 text-foreground/60 text-xs">
                        <span className="truncate">PixivBiu</span>
                    </div>
                </div>
                <div className="mac-window-drag-strip app-drag fixed inset-x-0 top-0 -z-10" aria-hidden="true" />
                <div ref={contentRef} data-window-content="" className="min-h-0 flex-1">
                    {children}
                </div>
            </div>
        </WindowContentBoundary>
    );
}
