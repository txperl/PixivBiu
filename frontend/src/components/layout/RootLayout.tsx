import { Outlet } from "react-router";
import RootSidebar from "@/components/layout/RootSidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

function RootLayout() {
    return (
        <ResizablePanelGroup orientation="horizontal" className="min-h-svh">
            <ResizablePanel defaultSize="18%" minSize="12%" maxSize="25%">
                <RootSidebar />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel>
                <main className="h-full">
                    <Outlet />
                </main>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

export default RootLayout;
