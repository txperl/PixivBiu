import { AccountButton } from "@/features/auth";
import { LanguageSwitcher } from "@/i18n";
import Logo from "./logo";
import Nav from "./nav";

function RootSidebar() {
    return (
        <aside className="flex h-full flex-col gap-4 bg-sidebar px-3 pt-4 pb-3">
            <div className="flex items-center gap-3 px-2 pt-1 pb-3">
                <Logo />
                <div className="min-w-0 flex-1">
                    <div className="font-medium text-base text-foreground">PixivBiu</div>
                    <div className="mt-px font-mono text-[11px] text-muted-foreground">v3.0 · M3</div>
                </div>
            </div>

            <Nav />

            <div className="flex-1" />

            <div className="flex flex-col gap-3">
                <AccountButton />
                <LanguageSwitcher className="w-full" />
            </div>
        </aside>
    );
}

export default RootSidebar;
