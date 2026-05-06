import { Outlet } from "react-router";
import RootSidebar from "@/app/layouts/root-sidebar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

function RootLayout() {
    return (
        <div className="h-svh overflow-hidden">
            <ResizablePanelGroup orientation="horizontal">
                <ResizablePanel defaultSize="14%" minSize="10%" maxSize="22%">
                    <RootSidebar />
                </ResizablePanel>
                <ResizableHandle />
                <ResizablePanel>
                    <main className="h-full overflow-y-auto">
                        <Outlet />
                    </main>
                </ResizablePanel>
            </ResizablePanelGroup>
        </div>
    );
}

export default RootLayout;
