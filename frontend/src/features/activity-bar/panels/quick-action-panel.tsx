import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDownloadMutations } from "@/features/downloads";
import { DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useQuickActionData } from "../items/quick-action";

function EmptyState({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <div className="font-medium text-foreground text-sm">{title}</div>
            {hint && <div className="text-muted-foreground text-xs leading-relaxed">{hint}</div>}
        </div>
    );
}

function QuickActionPanel() {
    const data = useQuickActionData();
    const { submit } = useDownloadMutations();
    const [pending, setPending] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);

    if (!data) {
        return (
            <EmptyState title="当前页面不支持批量操作" hint="进入作品列表（首页、搜索、排行榜、用户）后即可使用。" />
        );
    }

    const { selected, allIllustIds } = data;
    const selectedCount = selected.size;

    const onSubmit = async () => {
        if (pending || selectedCount === 0) return;
        setPending(true);
        setErrorTitle(null);
        const results = await Promise.all([...selected].map((id) => submit(id)));
        const okCount = results.filter((r) => r !== null).length;
        const anyFailed = results.length !== okCount;
        setPending(false);
        if (anyFailed) setErrorTitle("部分作品添加失败");
        if (okCount > 0) {
            data.onClearSelection();
        }
    };

    const hasSelection = selectedCount > 0;
    const onToggleSelect = () => {
        if (pending) return;
        if (hasSelection) data.onClearSelection();
        else data.onReplaceSelection(allIllustIds);
    };

    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="text-sm">选择</div>
            <div className="grid grid-cols-2 gap-2">
                <Button
                    variant="secondary"
                    onClick={onToggleSelect}
                    disabled={pending || (!hasSelection && allIllustIds.length === 0)}
                >
                    {hasSelection ? `取消选择 (${selectedCount})` : `全选 (${allIllustIds.length})`}
                </Button>
                <Button
                    className={cn(errorTitle && "ring-2 ring-destructive/40")}
                    onClick={onSubmit}
                    disabled={pending || selectedCount === 0}
                >
                    <HugeiconsIcon icon={DownloadIcon} />
                    {pending ? "添加中…" : `下载 (${selectedCount})`}
                </Button>
            </div>
            {errorTitle && <div className="text-destructive text-xs leading-relaxed">{errorTitle}</div>}
        </div>
    );
}

export default QuickActionPanel;
