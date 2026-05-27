import { NavLink } from "react-router";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDownloadCounts, useDownloadsPage } from "@/features/downloads";
import DownloadsTable from "@/features/downloads/components/downloads-table";
import { useMessages } from "@/i18n";
import { DownloadIcon } from "@/lib/icons";

const RECENT_LIMIT = 10;

function RecentDownloads() {
    const m = useMessages();
    const { items } = useDownloadsPage({ page: 1, perPage: RECENT_LIMIT });
    const { activeCount, doneCount } = useDownloadCounts();

    return (
        <Sheet>
            <SheetHead
                icon={DownloadIcon}
                title={m.downloads_title()}
                meta={m.downloads_recent_done_count({ active: activeCount, done: doneCount })}
                actions={
                    <NavLink to="/downloads">
                        <Button variant="ghost" size="sm">
                            {m.common_view_all()}
                        </Button>
                    </NavLink>
                }
            />
            <ScrollArea className="h-[300px]">
                <DownloadsTable jobs={items} compact />
            </ScrollArea>
        </Sheet>
    );
}

export default RecentDownloads;
