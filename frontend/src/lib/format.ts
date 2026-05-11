export function formatCount(n: number): string {
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
}

export function hueFromId(id: number): number {
    return (((id * 47) % 360) + 360) % 360;
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
