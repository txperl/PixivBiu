// Demo data for the home page until real /api/v1/illusts/* lists are wired up.
// Author / Work shapes are mock-only — replace with components["schemas"]["Illust"] etc.
// once data flows from the backend.

export type Author = {
    id: number;
    name: string;
    handle: string;
    hue: number;
};

export type Work = {
    id: number;
    title: string;
    author: Author;
    pages: number;
    bookmarks: number;
    views: number;
    ratio: "4/5" | "1/1" | "3/4";
    hue: number;
    tags: string[];
    isR: boolean;
    postedDays: number;
};

export type PopularTag = {
    name: string;
    count: number;
};

export const PB_AUTHORS: Author[] = [
    { id: 1, name: "小林 薄荷", handle: "kobayashi_mint", hue: 18 },
    { id: 2, name: "藤尾 澪", handle: "fujio_mio", hue: 210 },
    { id: 3, name: "月岛 和果", handle: "tsukishima_wk", hue: 160 },
    { id: 4, name: "九条 晴", handle: "kujo_hare", hue: 45 },
    { id: 5, name: "如月 穹", handle: "kisaragi_sora", hue: 260 },
    { id: 6, name: "白波 凛", handle: "shiranami_rin", hue: 200 },
    { id: 7, name: "七海 朔", handle: "nanami_saku", hue: 355 },
    { id: 8, name: "桐谷 栞", handle: "kiritani_shio", hue: 140 },
    { id: 9, name: "神无 夜灯", handle: "kanna_yoru", hue: 285 },
    { id: 10, name: "向井 砂", handle: "mukai_suna", hue: 70 },
];

const PB_TITLES = [
    "六月的河岸",
    "静物・柠檬与白盘",
    "校服少女与三只猫",
    "午后的便利店",
    "散步回家的路上",
    "深夜巴士",
    "温室里的蝴蝶",
    "纸上的小小剧场",
    "岛屿日记 第七页",
    "盛夏的水手服",
    "雨前的车站",
    "电车窗外的云",
    "星期天的厨房",
    "屋顶上的风",
    "樱色便签",
    "不眠夜笔记",
    "橘猫与落日",
    "水族馆午休",
    "书桌前的重影",
    "薄雾的早晨",
    "彩虹色的海苔卷",
    "秋天的便当",
    "十月的放学路",
    "粉笔灰与侧脸",
    "短发与耳机",
    "旧相机与胶卷",
    "向日葵阵列",
    "被折起的信",
    "下午三点半",
    "末班车上的素描",
];

const TAG_POOL = [
    "原创",
    "少女",
    "风景",
    "插画",
    "水彩",
    "夏日",
    "校服",
    "猫",
    "海",
    "夜",
    "月",
    "治愈",
    "漫画",
    "静物",
    "朝",
    "日常",
];

// Stable pseudo-random so the same work always has the same hue/ratio across renders.
export function seededHue(i: number): number {
    const x = Math.sin(i * 9301 + 49297) * 233280;
    return x - Math.floor(x);
}

function pickTags(i: number): string[] {
    const n = 2 + ((i * 13) % 3);
    const out: string[] = [];
    for (let k = 0; k < n; k++) out.push(TAG_POOL[(i * 7 + k * 3) % TAG_POOL.length]);
    return [...new Set(out)];
}

export const PB_WORKS: Work[] = PB_TITLES.map((title, i) => {
    const a = PB_AUTHORS[i % PB_AUTHORS.length];
    const r = seededHue(i + 1);
    const r2 = seededHue(i + 11);
    const pages = r2 > 0.82 ? 2 + Math.floor(r * 6) : 1;
    const bookmarks = Math.floor(200 + r * 9800);
    const views = bookmarks * (5 + Math.floor(r2 * 8));
    return {
        id: i + 1,
        title,
        author: a,
        pages,
        bookmarks,
        views,
        ratio: r2 < 0.33 ? "4/5" : r2 < 0.7 ? "1/1" : "3/4",
        hue: a.hue + Math.floor((r - 0.5) * 30),
        tags: pickTags(i),
        isR: false,
        postedDays: 1 + Math.floor(r * 30),
    };
});

export const PB_TAGS_POPULAR: PopularTag[] = [
    { name: "原创", count: 12_840 },
    { name: "少女", count: 9_210 },
    { name: "风景", count: 6_870 },
    { name: "治愈", count: 5_140 },
    { name: "夏日", count: 4_720 },
    { name: "猫", count: 4_310 },
    { name: "水彩", count: 3_960 },
    { name: "夜", count: 3_410 },
];

export function formatCount(n: number): string {
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
}
