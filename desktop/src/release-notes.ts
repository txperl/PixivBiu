// Pure helpers for stitching desktop release notes across skipped versions.
// electron-updater only embeds the newest release's notes (latest*.yml), so a
// user jumping 1.0.0 → 1.0.3 would miss 1.0.1/1.0.2. The main process fetches
// the release list and stitches each version's changelog section, mirroring
// the core's aggregateNotes (internal/update/checker.go). No Electron imports
// here, so the logic stays unit-testable under plain node.

// Must match scripts/desktop-release.mjs, which fences the user-facing
// changelog in each GitHub release body with these markers.
export const CHANGELOG_START = "<!-- pixivbiu:changelog:start -->";
export const CHANGELOG_END = "<!-- pixivbiu:changelog:end -->";

export interface GitHubRelease {
    tag_name: string;
    draft: boolean;
    body: string | null;
}

interface ParsedVersion {
    precedence: number[];
    prerelease: boolean;
}

const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/;
const channelRank: Record<string, number> = { alpha: 0, beta: 1 };

// Desktop versions are strictly X.Y.Z or X.Y.Z-(alpha|beta).N (enforced by
// the release workflow), so a tiny comparator covers them without semver.
export function parseVersion(version: string): ParsedVersion | undefined {
    const m = versionPattern.exec(version.trim());
    if (!m) return undefined;
    const channel = m[4];
    return {
        precedence: [Number(m[1]), Number(m[2]), Number(m[3]), channel ? (channelRank[channel] ?? 0) : 2, Number(m[5] ?? 0)],
        prerelease: channel !== undefined,
    };
}

function compare(a: ParsedVersion, b: ParsedVersion): number {
    for (let i = 0; i < a.precedence.length; i++) {
        const diff = (a.precedence[i] ?? 0) - (b.precedence[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

// extractChangelog returns the fenced changelog section of a release body, or
// undefined for releases published before the markers existed.
export function extractChangelog(body: string | null | undefined): string | undefined {
    if (!body) return undefined;
    const start = body.indexOf(CHANGELOG_START);
    if (start < 0) return undefined;
    const from = start + CHANGELOG_START.length;
    const end = body.indexOf(CHANGELOG_END, from);
    if (end < 0) return undefined;
    const section = body.slice(from, end).trim();
    return section || undefined;
}

// stitchReleaseNotes joins the changelogs of every release in (current, latest],
// newest first, under "## vX" headings (the SPA renders h2 as a version heading
// and the changelog's own h3 groups beneath it). Prereleases in between only
// count for a user already on a prerelease — electron-updater's allowPrerelease
// default — while the offered release itself is always included. Returns
// undefined when there is nothing to stitch, so the caller keeps its notes.
export function stitchReleaseNotes(releases: GitHubRelease[], current: string, latest: string): string | undefined {
    const cur = parseVersion(current);
    const target = parseVersion(latest);
    if (!cur || !target || compare(target, cur) <= 0) return undefined;

    const sections: Array<{ version: ParsedVersion; label: string; notes: string }> = [];
    for (const release of releases) {
        if (release.draft) continue;
        const version = parseVersion(release.tag_name);
        if (!version || compare(version, cur) <= 0 || compare(version, target) > 0) continue;
        if (version.prerelease && !cur.prerelease && compare(version, target) !== 0) continue;
        const notes = extractChangelog(release.body);
        if (!notes) continue;
        sections.push({ version, label: `v${release.tag_name.replace(/^v/, "")}`, notes });
    }
    if (sections.length < 2) return undefined;

    sections.sort((a, b) => compare(b.version, a.version));
    return sections.map((s) => `## ${s.label}\n\n${s.notes}`).join("\n\n");
}

// parseFeedRepository reads owner/repo from the packaged app-update.yml, which
// electron-builder generates from the publish block in electron-builder.yml —
// keeping that block the single source of truth for forks.
export function parseFeedRepository(appUpdateYml: string): { owner: string; repo: string } | undefined {
    const field = (key: string) => new RegExp(`^${key}:\\s*['"]?([A-Za-z0-9_.-]+)['"]?\\s*$`, "m").exec(appUpdateYml)?.[1];
    if (field("provider") !== "github") return undefined;
    const owner = field("owner");
    const repo = field("repo");
    return owner && repo ? { owner, repo } : undefined;
}
