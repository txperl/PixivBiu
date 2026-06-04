import { useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import RootSidebar from "@/app/layouts/root-sidebar";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActivityBar, ActivityPanel, useActivityBar } from "@/features/activity-bar";
import { useAuth } from "@/features/auth";

const ACTIVITY_PANEL_DEFAULT_SIZE = 20;

function ActivityPanelSlot() {
    const { isOpen, activeItemId } = useActivityBar();
    const preferredSizeRef = useRef(ACTIVITY_PANEL_DEFAULT_SIZE);

    if (!isOpen || !activeItemId) return null;

    return (
        <>
            <ResizableHandle />
            <ResizablePanel
                id="activity-panel"
                defaultSize={`${preferredSizeRef.current}%`}
                minSize="20%"
                maxSize="40%"
                onResize={({ asPercentage }) => {
                    preferredSizeRef.current = asPercentage;
                }}
            >
                <ActivityPanel />
            </ResizablePanel>
        </>
    );
}

function RootLayout() {
    const { status } = useAuth();
    const location = useLocation();

    // First refresh is still in flight. Show a near-empty splash so the layout
    // doesn't flash a half-loaded app before we know where the user belongs.
    if (status === null) {
        return (
            <div className="flex h-svh items-center justify-center bg-background">
                <span
                    className="fade-in animate-in text-muted-foreground/70 text-sm duration-500"
                    style={{ animationFillMode: "backwards" }}
                >
                    <LeapyLoading size={18} />
                </span>
            </div>
        );
    }

    if (!status.authenticated) {
        return <Navigate to="/login" replace state={{ from: location }} />;
    }

    return (
        <div className="flex h-svh overflow-hidden">
            <ResizablePanelGroup className="min-w-0 flex-1" orientation="horizontal">
                <ResizablePanel id="sidebar" defaultSize="14%" minSize="10%" maxSize="22%">
                    <RootSidebar />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel id="main">
                    {/* The ScrollArea viewport (not <main>) is the real page scroller — see
                        [data-app-scroller] consumers in settings scroll-spy + pager scroll-to-top. */}
                    <main className="h-full min-h-0">
                        <ScrollArea className="h-full" viewportProps={{ "data-app-scroller": "" }}>
                            <Outlet />
                        </ScrollArea>
                    </main>
                </ResizablePanel>
                <ActivityPanelSlot />
            </ResizablePanelGroup>
            <ActivityBar />
        </div>
    );
}

export default RootLayout;
