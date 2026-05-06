import { HugeiconsIcon } from "@hugeicons/react";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { CloseIcon, DownloadIcon, FolderIcon, PauseIcon } from "@/lib/icons";
import { PB_DOWNLOADS } from "../mock";

function DownloadsSheet() {
    return (
        <Sheet>
            <SheetHead
                icon={DownloadIcon}
                title="下载管理"
                meta="2 进行 / 2 完成"
                actions={
                    <>
                        <Button variant="ghost" size="sm">
                            全部暂停
                        </Button>
                        <Button variant="ghost" size="sm">
                            查看全部
                        </Button>
                    </>
                }
            />
            <table className="w-full border-collapse text-sm">
                <thead>
                    <tr className="bg-muted/40 text-[11px] text-muted-foreground">
                        <th className="px-[18px] py-2.5 text-left font-medium">作品</th>
                        <th className="px-[18px] py-2.5 text-left font-medium">进度</th>
                        <th className="px-[18px] py-2.5 text-right font-medium">大小</th>
                        <th className="w-20 px-[18px] py-2.5 text-right font-medium">操作</th>
                    </tr>
                </thead>
                <tbody>
                    {PB_DOWNLOADS.map((d) => (
                        <tr key={d.id} className="border-muted/40 border-t">
                            <td className="px-[18px] py-3 align-middle">
                                <div className="flex items-center gap-3">
                                    <div
                                        className="size-8 shrink-0 rounded-lg"
                                        style={{
                                            background: `oklch(0.86 0.06 ${30 + d.id.charCodeAt(1) * 9})`,
                                        }}
                                    />
                                    <div className="min-w-0">
                                        <div className="truncate font-medium text-foreground text-sm">{d.title}</div>
                                        <div className="text-[11px] text-muted-foreground">
                                            {d.author} · {d.pages} 页
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td className="px-[18px] py-3 align-middle">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                        <div
                                            className={`h-full rounded-full ${d.state === "done" ? "bg-chart-3" : "bg-primary"}`}
                                            style={{ width: `${d.progress * 100}%` }}
                                        />
                                    </div>
                                    <span className="min-w-8 text-right font-mono text-[11px] text-muted-foreground">
                                        {Math.round(d.progress * 100)}%
                                    </span>
                                </div>
                            </td>
                            <td className="px-[18px] py-3 text-right font-mono text-muted-foreground text-xs">
                                {d.size}
                            </td>
                            <td className="px-[18px] py-3 text-right">
                                <div className="inline-flex gap-1">
                                    <button
                                        type="button"
                                        className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60"
                                    >
                                        <HugeiconsIcon
                                            icon={d.state === "done" ? FolderIcon : PauseIcon}
                                            size={14}
                                            strokeWidth={1.5}
                                        />
                                    </button>
                                    <button
                                        type="button"
                                        className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60"
                                    >
                                        <HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={1.5} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Sheet>
    );
}

export default DownloadsSheet;
