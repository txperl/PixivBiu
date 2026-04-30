import { HugeiconsIcon } from "@hugeicons/react";
import { DownloadIcon } from "@/lib/icons";

function DownloadStatusCard() {
    return (
        <div className="mb-2 rounded-xl bg-card px-3.5 py-3">
            <div className="mb-2 flex items-center gap-2">
                <div className="flex size-[22px] items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <HugeiconsIcon icon={DownloadIcon} size={12} strokeWidth={1.5} />
                </div>
                <span className="font-medium text-foreground text-xs">下载中 · 2</span>
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-muted-foreground">49%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: "49%" }} />
            </div>
        </div>
    );
}

export default DownloadStatusCard;
