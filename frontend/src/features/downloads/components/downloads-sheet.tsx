import { NavLink } from "react-router";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { useDownloads } from "@/features/downloads";
import DownloadsTable from "@/features/downloads/components/downloads-table";
import { DownloadIcon } from "@/lib/icons";

const RECENT_LIMIT = 5;

function DownloadsSheet() {
    const { jobs, activeCount, doneCount } = useDownloads();
    const recent = jobs.slice(0, RECENT_LIMIT);

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
