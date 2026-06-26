import { formatDistanceToNow } from "date-fns";
import { ja, zhCN } from "date-fns/locale";

export function formatCount(n: number): string {
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
}

export function hueFromId(id: number): number {
    return (((id * 47) % 360) + 360) % 360;
}

// Formats an ISO 8601 timestamp (e.g. Pixiv's create_date "2023-05-01T12:34:56+09:00")
// as a locale-aware short date. Pass the active UI locale so it tracks language switches;
// falls back to the raw string if the input doesn't parse.
//
// The displayed date is the artwork's *own* calendar date (Pixiv serves JST), not the
// viewer's. We read the source offset and reinterpret the wall-clock instant as UTC,
// then format in UTC — otherwise a post just after midnight JST would slip to the
// previous day for viewers west of it (and vice versa).
export function formatDate(iso: string, locale?: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const offset = iso.match(/([+-])(\d{2}):?(\d{2})$/);
    const offsetMin = offset ? (offset[1] === "-" ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
    const wall = new Date(d.getTime() + offsetMin * 60_000);
    return new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    }).format(wall);
}

// date-fns locales for relative-time formatting; "en" uses the library default
// (enUS), so it isn't listed here.
const RELATIVE_LOCALES = { "zh-CN": zhCN, ja } as const;

// Localized "3 days ago" for an ISO timestamp, or null when it's missing or
// unparseable (so callers can omit the line). Pass the active UI locale so the
// phrasing tracks language switches.
export function formatRelativeTime(iso: string | null | undefined, locale: string): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return formatDistanceToNow(d, {
        addSuffix: true,
        locale: RELATIVE_LOCALES[locale as keyof typeof RELATIVE_LOCALES],
    });
}

export function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
