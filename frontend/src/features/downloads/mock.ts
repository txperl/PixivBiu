// Demo download list — replaced by /api/v1/downloads + SSE once events feature lands.

export type DownloadItem = {
    id: string;
    title: string;
    author: string;
    pages: number;
    progress: number;
    state: "downloading" | "done";
    size: string;
};

export const PB_DOWNLOADS: DownloadItem[] = [
    {
        id: "d1",
        title: "深夜巴士",
        author: "月岛 和果",
        pages: 4,
        progress: 0.68,
        state: "downloading",
        size: "8.4 MB",
    },
    {
        id: "d2",
        title: "星期天的厨房",
        author: "九条 晴",
        pages: 1,
        progress: 0.32,
        state: "downloading",
        size: "2.1 MB",
    },
    { id: "d3", title: "樱色便签", author: "小林 薄荷", pages: 3, progress: 1.0, state: "done", size: "6.9 MB" },
    { id: "d4", title: "水族馆午休", author: "藤尾 澪", pages: 1, progress: 1.0, state: "done", size: "1.8 MB" },
];
