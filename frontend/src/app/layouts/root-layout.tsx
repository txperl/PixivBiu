import { useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import RootSidebar from "@/app/layouts/root-sidebar";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActivityBar, ActivityPanel, useActivityBar } from "@/features/activity-bar";
import { useAuth } from "@/features/auth";
import { IllustViewerProvider } from "@/features/illusts/illust-viewer";

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
                className="window-activity-panel"
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
            <div className="flex h-full items-center justify-center bg-background frost:bg-transparent">
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
        <IllustViewerProvider>
            <div className="window-root-layout flex h-full overflow-hidden">
                <ResizablePanelGroup className="min-w-0 flex-1" orientation="horizontal">
                    <ResizablePanel id="sidebar" defaultSize="14%" minSize="10%" maxSize="22%">
                        <RootSidebar />
                    </ResizablePanel>
                    <ResizableHandle className="window-sidebar-handle" />
                    <ResizablePanel id="main" className="window-main-panel">
                        {/* The ScrollArea viewport (not <main>) is the real page scroller — see
                            [data-app-scroller] consumers in settings scroll-spy + pager scroll-to-top. */}
                        <main className="window-main-surface h-full min-h-0 bg-background">
                            <ScrollArea className="h-full" viewportProps={{ "data-app-scroller": "" }}>
                                <Outlet />
                            </ScrollArea>
                        </main>
                    </ResizablePanel>
                    <ActivityPanelSlot />
                </ResizablePanelGroup>
                <ActivityBar />
            </div>
        </IllustViewerProvider>
    );
}

export default RootLayout;
