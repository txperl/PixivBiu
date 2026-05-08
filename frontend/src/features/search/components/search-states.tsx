import type { SearchApiError } from "@/features/search/api";

const ERROR_MESSAGES: Record<string, string> = {
    unauthenticated: "请先登录 Pixiv 账号",
    not_found: "未找到对应资源",
    rate_limited: "请求过于频繁，请稍后再试",
};

export function SearchError({ error }: { error: SearchApiError }) {
    const msg = ERROR_MESSAGES[error.code] ?? error.message;
    return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            <div className="font-medium">{error.code}</div>
            <div className="text-destructive/90">{msg}</div>
            {error.detail && <div className="mt-1 text-destructive/70 text-xs">{error.detail}</div>}
        </div>
    );
}

export function SearchEmptyState() {
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">输入关键词开始搜索</div>
            <div className="text-muted-foreground text-sm">支持作品标签、标题、作者名</div>
        </div>
    );
}

export function SearchNoResults({ word }: { word: string }) {
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">没有匹配「{word}」的结果</div>
            <div className="text-muted-foreground text-sm">换个关键词或调整筛选条件试试</div>
        </div>
    );
}
