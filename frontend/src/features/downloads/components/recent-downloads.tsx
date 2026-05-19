import { NavLink } from "react-router";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDownloadCounts, useDownloadsPage } from "@/features/downloads";
import DownloadsTable from "@/features/downloads/components/downloads-table";
import { DownloadIcon } from "@/lib/icons";

const RECENT_LIMIT = 10;

function RecentDownloads() {
    const { items } = useDownloadsPage({ page: 1, perPage: RECENT_LIMIT });
    const { activeCount, doneCount } = useDownloadCounts();

    return (
        <Sheet>
            <SheetHead
                icon={DownloadIcon}
                title="下载管理"
                meta={`${activeCount} 进行 / ${doneCount} 完成`}
                actions={
                    <NavLink to="/downloads">
                        <Button variant="ghost" size="sm">
                            查看全部
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
