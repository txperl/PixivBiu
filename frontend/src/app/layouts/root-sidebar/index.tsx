import { AccountButton } from "@/features/auth";
import Nav from "./nav";

function RootSidebar() {
    return (
        // pt: 1rem in the browser; on the macOS frameless shell the wordmark
        // drops below the traffic lights (--traffic-lights-inset, desktop.css).
        // app-drag: native-style sidebar — empty pixels drag the window, the
        // nav links/buttons punch no-drag holes (desktop.css). Inert in the
        // browser.
        <aside className="app-drag flex h-full flex-col gap-4 bg-sidebar px-3 pt-[max(1rem,var(--traffic-lights-inset,0px))] pb-3">
            <div className="flex items-center gap-1.5 px-2 pt-1 pb-3">
                <div className="font-medium text-foreground text-xl">PixivBiu</div>
            </div>

            <Nav />

            <div className="flex-1" />

            <div className="flex flex-col gap-3">
                <AccountButton />
            </div>
        </aside>
    );
}

export default RootSidebar;
