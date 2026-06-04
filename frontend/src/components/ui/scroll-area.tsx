import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "@/lib/utils";

type ScrollAreaProps = ScrollAreaPrimitive.Root.Props & {
    // Allow data-* markers (e.g. data-app-scroller) on the viewport — base-ui's
    // Viewport.Props doesn't include the data-* index that JSX special-cases.
    viewportProps?: ScrollAreaPrimitive.Viewport.Props & Partial<Record<`data-${string}`, string>>;
};

function ScrollArea({ className, children, viewportProps, ...props }: ScrollAreaProps) {
    return (
        <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
            <ScrollAreaPrimitive.Viewport
                data-slot="scroll-area-viewport"
                {...viewportProps}
                className={cn(
                    "size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    viewportProps?.className,
                )}
            >
                {children}
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    );
}

function ScrollBar({ className, orientation = "vertical", ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
    return (
        <ScrollAreaPrimitive.Scrollbar
            data-slot="scroll-area-scrollbar"
            data-orientation={orientation}
            orientation={orientation}
            className={cn(
                "flex touch-none select-none p-px data-horizontal:h-2.5 data-vertical:h-full data-vertical:w-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:border-l data-vertical:border-l-transparent",
                // Auto-hide like macOS: invisible by default, fade in while the pointer
                // is over the scroll area or the user is actively scrolling. Base UI only
                // mounts the scrollbar when there's overflow, so a non-scrolling area shows nothing.
                "opacity-0 transition-opacity duration-200 ease-out data-hovering:opacity-100 data-scrolling:opacity-100",
                className,
            )}
            {...props}
        >
            <ScrollAreaPrimitive.Thumb
                data-slot="scroll-area-thumb"
                className="relative flex-1 rounded-full bg-muted-foreground/35 transition-colors hover:bg-muted-foreground/55"
            />
        </ScrollAreaPrimitive.Scrollbar>
    );
}

export { ScrollArea, ScrollBar };
