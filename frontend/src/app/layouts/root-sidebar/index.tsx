import { AccountButton } from "@/features/auth";
import Nav from "./nav";

function RootSidebar() {
    return (
        <aside className="flex h-full flex-col gap-4 bg-sidebar px-3 pt-4 pb-3">
            <div className="flex items-center gap-1 px-2 pt-1 pb-3">
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
