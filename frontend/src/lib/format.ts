export function formatCount(n: number): string {
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
}

export function hueFromId(id: number): number {
    return (((id * 47) % 360) + 360) % 360;
}
