import { useMemo } from "react";
import { NavLink } from "react-router";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { useDownloadCounts, useTrackedDownloads } from "@/features/downloads";
import DownloadsTable from "@/features/downloads/components/downloads-table";
import { DownloadIcon } from "@/lib/icons";

const RECENT_LIMIT = 5;

function DownloadsSheet() {
    const { tracked } = useTrackedDownloads();
    const { activeCount, doneCount } = useDownloadCounts();
    // Recent = the freshest jobs in the tracked map (active + 30min-old terminal).
    // Sort by created_at desc since insertion order isn't authoritative.
    const recent = useMemo(() => {
        return Array.from(tracked.values())
            .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
            .slice(0, RECENT_LIMIT);
    }, [tracked]);

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
            <DownloadsTable jobs={recent} compact />
        </Sheet>
    );
}

export default DownloadsSheet;
