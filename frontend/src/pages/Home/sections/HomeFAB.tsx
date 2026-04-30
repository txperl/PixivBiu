import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { CloseIcon, DownloadIcon } from "@/lib/icons";

type HomeFABProps = {
    selectedCount: number;
    onDownload: () => void;
    onClearSelection: () => void;
};

function HomeFAB({ selectedCount, onDownload, onClearSelection }: HomeFABProps) {
    if (selectedCount === 0) return null;

    return (
        <div className="fixed right-6 bottom-6 flex flex-col items-end gap-2">
            <Button className="h-10 rounded-2xl px-3 text-xs" onClick={onDownload}>
                <HugeiconsIcon icon={DownloadIcon} />
                批量下载
            </Button>
            <Button size="icon-lg" className="rounded-full" onClick={onClearSelection}>
                <HugeiconsIcon icon={CloseIcon} strokeWidth={2.5} />
            </Button>
        </div>
    );
}

export default HomeFAB;
