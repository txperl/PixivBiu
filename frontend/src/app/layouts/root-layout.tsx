import { useRef } from "react";
import { Outlet } from "react-router";
import RootSidebar from "@/app/layouts/root-sidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ActivityBar, ActivityPanel, useActivityBar } from "@/features/activity-bar";

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
    return (
        <div className="flex h-svh overflow-hidden">
            <ResizablePanelGroup className="min-w-0 flex-1" orientation="horizontal">
                <ResizablePanel id="sidebar" defaultSize="14%" minSize="10%" maxSize="22%">
                    <RootSidebar />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel id="main">
                    <main className="h-full overflow-y-auto">
                        <Outlet />
                    </main>
                </ResizablePanel>
                <ActivityPanelSlot />
            </ResizablePanelGroup>
            <ActivityBar />
        </div>
    );
}

export default RootLayout;
