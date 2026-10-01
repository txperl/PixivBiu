import { useRef } from "react";
import { Navigate, useLocation } from "react-router";
import { KeepAliveControlProvider, KeepAliveOutlet } from "@/app/keep-alive/keep-alive-outlet";
import RootSidebar from "@/app/layouts/root-sidebar";
import { SectionMemoryProvider } from "@/app/layouts/section-memory";
import { appRoutes } from "@/app/routes";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ActivityBar, ActivityPanel, useActivityBar } from "@/features/activity-bar";
import { useAuth } from "@/features/auth";
import { IllustSelectionProvider, SelectionActionBar } from "@/features/downloads";
import { IllustViewerProvider } from "@/features/illusts/illust-viewer";
import { PageRefreshProvider } from "@/lib/page-refresh";

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

    // Keyed by account: a session switch drops every kept page and remembered section
    // URL, matching AuthGatedQueryReset clearing the query cache.
    const accountKey = status.user_id ?? "auth";

    return (
        <IllustViewerProvider>
            <KeepAliveControlProvider>
                <PageRefreshProvider>
                    <SectionMemoryProvider key={accountKey} selfUserId={status.user_id}>
                        <IllustSelectionProvider>
                            <div className="window-root-layout flex h-full overflow-hidden">
                                <ResizablePanelGroup className="min-w-0 flex-1" orientation="horizontal">
                                    <ResizablePanel id="sidebar" defaultSize="14%" minSize="10%" maxSize="22%">
                                        <RootSidebar />
                                    </ResizablePanel>
                                    <ResizableHandle className="window-sidebar-handle" />
                                    <ResizablePanel id="main" className="window-main-panel">
                                        {/* The ScrollArea viewport (not <main>) is the real page scroller — see
                                    [data-app-scroller] consumers in settings scroll-spy, pager scroll-to-top
                                    and KeepAliveOutlet's per-page scroll restore. */}
                                        <main className="window-main-surface relative h-full min-h-0 bg-background">
                                            <ScrollArea
                                                className="h-full"
                                                viewportProps={{
                                                    "data-app-scroller": "",
                                                    className: "scroll-pb-[var(--selection-bar-space,0px)]",
                                                }}
                                            >
                                                <div className="min-h-full pb-[var(--selection-bar-space,0px)]">
                                                    <KeepAliveOutlet
                                                        key={accountKey}
                                                        routes={appRoutes}
                                                        selfUserId={status.user_id}
                                                    />
                                                </div>
                                            </ScrollArea>
                                            <SelectionActionBar />
                                        </main>
                                    </ResizablePanel>
                                    <ActivityPanelSlot />
                                </ResizablePanelGroup>
                                <ActivityBar />
                            </div>
                        </IllustSelectionProvider>
                    </SectionMemoryProvider>
                </PageRefreshProvider>
            </KeepAliveControlProvider>
        </IllustViewerProvider>
    );
}

export default RootLayout;
