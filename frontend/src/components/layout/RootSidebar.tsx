import { LanguageSwitcher } from "@/lib/i18n";

function RootSidebar() {
    return (
        <aside className="flex h-full flex-col bg-sidebar">
            <div className="flex-1" />
            <div className="border-sidebar-border border-t p-2">
                <LanguageSwitcher className="w-full" />
            </div>
        </aside>
    );
}

export default RootSidebar;
