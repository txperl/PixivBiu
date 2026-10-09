#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const desktopTagPattern =
  /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/;
const coreTagPattern =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const conventionalSubjectPattern = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

// Markers fence the user-facing changelog inside the GitHub release body so the
// desktop main process can stitch skipped versions from the Releases API
// without the downloads table. Mirrored in desktop/src/release-notes.ts.
export const changelogStartMarker = "<!-- pixivbiu:changelog:start -->";
export const changelogEndMarker = "<!-- pixivbiu:changelog:end -->";

// Only user-visible change types reach the changelog. Everything else
// (chore/ci/build/docs/test/style/refactor) is maintenance noise for users.
// Group headings are h3 so the SPA's release-notes dialog renders them as group
// labels beneath stitched "## vX" version headings.
const changelogGroups = [
  { type: "feat", title: "Features" },
  { type: "fix", title: "Bug fixes" },
  { type: "perf", title: "Performance" },
];

const channelRank = { alpha: 0, beta: 1, stable: 2 };

export function parseDesktopTag(tag) {
  const match = desktopTagPattern.exec(tag);
  if (!match) {
    throw new Error(
      `invalid desktop release tag ${JSON.stringify(tag)}; expected desktop-vX.Y.Z, desktop-vX.Y.Z-alpha.N, or desktop-vX.Y.Z-beta.N`,
    );
  }

  const version = tag.slice("desktop-v".length);
  const channel = match[4] ?? "stable";
  const channelLabel = channel === "stable" ? "" : ` (${channel[0].toUpperCase()}${channel.slice(1)})`;
  return {
    tag,
    version,
    channel,
    precedence: [Number(match[1]), Number(match[2]), Number(match[3]), channelRank[channel], Number(match[5] ?? 0)],
    prerelease: channel !== "stable",
    title: `PixivBiu Desktop v${version}${channelLabel}`,
  };
}

function comparePrecedence(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// previousDesktopTag picks the changelog baseline for tag: the closest lower
// desktop tag, where a stable release only compares against the previous
// stable one so its notes cover every alpha/beta that led up to it.
export function previousDesktopTag(tag, tags) {
  const current = parseDesktopTag(tag);
  let best;
  for (const candidate of tags) {
    let parsed;
    try {
      parsed = parseDesktopTag(candidate);
    } catch {
      continue;
    }
    if (!current.prerelease && parsed.prerelease) continue;
    if (comparePrecedence(parsed.precedence, current.precedence) >= 0) continue;
    if (!best || comparePrecedence(parsed.precedence, best.precedence) > 0) best = parsed;
  }
  return best?.tag;
}

// parseCommitSubject reads a Conventional Commit subject. Non-conforming
// subjects return undefined and are left out of user-facing notes.
export function parseCommitSubject(subject) {
  const match = conventionalSubjectPattern.exec(subject.trim());
  if (!match) return undefined;
  return { type: match[1].toLowerCase(), scope: match[2] ?? "", breaking: Boolean(match[3]), description: match[4].trim() };
}

function isDesktopScope(commit) {
  return commit.scope === "desktop";
}

function commitLine(commit) {
  const text = commit.description[0].toUpperCase() + commit.description.slice(1);
  return commit.breaking ? `- **Breaking:** ${text}` : `- ${text}`;
}

// renderChangelog turns the selected commits into the user-facing changelog
// Markdown shared by the in-app updater (via latest*.yml) and the release page.
export function renderChangelog({ highlights = "", commits = [], coreChange, initial = false }) {
  const sections = [];
  const trimmedHighlights = highlights.trim();
  if (trimmedHighlights) {
    sections.push(`### Highlights\n\n${trimmedHighlights}`);
  }

  const seen = new Set();
  for (const group of changelogGroups) {
    const lines = [];
    for (const commit of commits) {
      if (commit.type !== group.type) continue;
      const line = commitLine(commit);
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
    if (lines.length > 0) {
      sections.push(`### ${group.title}\n\n${lines.join("\n")}`);
    }
  }

  if (sections.length === 0) {
    sections.push(initial ? "Initial release." : "Maintenance release with internal improvements.");
  }
  if (coreChange) {
    const link = `[\`${coreChange.to}\`](https://github.com/${coreChange.repository}/releases/tag/${encodeURIComponent(coreChange.to)})`;
    sections.push(
      coreChange.from
        ? `Bundled core updated from \`${coreChange.from}\` to ${link}.`
        : `Bundles core ${link}.`,
    );
  }
  return `${sections.join("\n\n")}\n`;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function commitsInRange(cwd, range) {
  const output = git(cwd, ["log", "--reverse", "--no-merges", "--format=%s%x1e", range]);
  return output
    .split("\x1e")
    .map((subject) => parseCommitSubject(subject))
    .filter(Boolean);
}

function coreVersionAt(cwd, ref) {
  try {
    return git(cwd, ["show", `${ref}:desktop/.core-version`]).trim();
  } catch {
    return undefined;
  }
}

// Annotated tag messages become hand-written highlights; lightweight tags
// (and the tag's signature block) contribute nothing.
function tagHighlights(cwd, tag) {
  const ref = `refs/tags/${tag}`;
  if (git(cwd, ["for-each-ref", "--format=%(objecttype)", ref]).trim() !== "tag") return "";
  const contents = git(cwd, ["for-each-ref", "--format=%(contents)", ref]);
  return contents.split(/^-----BEGIN [A-Z ]*SIGNATURE-----$/m)[0].trim();
}

// generateChangelog builds a desktop release's changelog from local git
// history. Shell changes are desktop-scoped commits since the previous desktop
// tag; core changes are the non-desktop commits between the previously and
// newly pinned core tags — the same scope rule that keeps desktop commits out
// of the core's own GoReleaser changelog.
export function generateChangelog({ tag, sourceRepository, cwd = process.cwd() }) {
  parseDesktopTag(tag);
  assertRepository(sourceRepository, "source");
  const ref = `refs/tags/${tag}`;
  const tags = git(cwd, ["tag", "--list", "desktop-v*"]).split(/\r?\n/).filter(Boolean);
  const previous = previousDesktopTag(tag, tags);
  const highlights = tagHighlights(cwd, tag);
  const newCore = coreVersionAt(cwd, ref);
  if (!newCore || !coreTagPattern.test(newCore)) {
    throw new Error(`invalid bundled core version ${JSON.stringify(newCore)} at ${tag}`);
  }

  if (!previous) {
    return renderChangelog({
      highlights,
      initial: true,
      coreChange: { to: newCore, repository: sourceRepository },
    });
  }

  const commits = commitsInRange(cwd, `refs/tags/${previous}..${ref}`).filter(isDesktopScope);
  const oldCore = coreVersionAt(cwd, `refs/tags/${previous}`);
  let coreChange;
  if (oldCore !== newCore) {
    coreChange = { from: oldCore, to: newCore, repository: sourceRepository };
    const range = oldCore ? `refs/tags/${oldCore}..refs/tags/${newCore}` : `refs/tags/${newCore}`;
    commits.push(...commitsInRange(cwd, range).filter((commit) => !isDesktopScope(commit)));
  }
  return renderChangelog({ highlights, commits, coreChange });
}

export function artifactNames(version) {
  const prefix = `PixivBiu-Desktop-${version}`;
  return {
    macArmDmg: `${prefix}-darwin-arm64.dmg`,
    macX64Dmg: `${prefix}-darwin-x64.dmg`,
    macArmZip: `${prefix}-darwin-arm64.zip`,
    macX64Zip: `${prefix}-darwin-x64.zip`,
    windowsSetup: `${prefix}-windows-x64-setup.exe`,
    linuxAppImage: `${prefix}-linux-x86_64.AppImage`,
    linuxDeb: `${prefix}-linux-amd64.deb`,
    linuxRpm: `${prefix}-linux-x86_64.rpm`,
  };
}

function assertRepository(repository, label) {
  if (!repositoryPattern.test(repository)) {
    throw new Error(`invalid ${label} repository ${JSON.stringify(repository)}; expected owner/name`);
  }
}

function parseUpdateMetadata(contents, filename) {
  let version = "";
  const urls = [];

  for (const line of contents.split(/\r?\n/)) {
    const versionMatch = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (versionMatch) {
      version = versionMatch[1];
    }

    const urlMatch = /^\s*-\s+url:\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(line);
    if (urlMatch) {
      urls.push(urlMatch[1] ?? urlMatch[2] ?? urlMatch[3]);
    }
  }

  if (!version) {
    throw new Error(`${filename} has no top-level version`);
  }
  return { version, urls };
}

function assertExactMembers(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(
      `${label} contains ${JSON.stringify(actualSorted)}; expected ${JSON.stringify(expectedSorted)}`,
    );
  }
}

function releaseAssetUrl(repository, version, filename) {
  return `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(filename)}`;
}

export function renderReleaseNotes(info, coreVersion, sourceRepository, desktopRepository, changelog) {
  if (!coreTagPattern.test(coreVersion)) {
    throw new Error(`invalid bundled core version ${JSON.stringify(coreVersion)}; expected a v-prefixed SemVer tag`);
  }
  assertRepository(sourceRepository, "source");
  assertRepository(desktopRepository, "desktop release");
  if (typeof changelog !== "string" || changelog.trim() === "") {
    throw new Error("desktop release changelog must be non-empty Markdown");
  }

  const names = artifactNames(info.version);
  const download = (name) => `[\`${name}\`](${releaseAssetUrl(desktopRepository, info.version, name)})`;
  const lines = [];

  if (info.prerelease) {
    const previewLabel = info.channel === "alpha" ? "an Alpha" : "a Beta";
    lines.push(
      "> [!WARNING]",
      `> This is ${previewLabel} preview and may be unstable.`,
      "",
    );
  }

  lines.push(
    "PixivBiu Desktop is the native desktop distribution of PixivBiu, with one-click Pixiv sign-in and app-managed updates.",
    "",
    "## What's changed",
    "",
    changelogStartMarker,
    "",
    changelog.trim(),
    "",
    changelogEndMarker,
    "",
    "## Downloads",
    "",
    "| Platform | Download | Notes |",
    "| --- | --- | --- |",
    `| macOS — Apple silicon | ${download(names.macArmDmg)} | macOS 13+, M1 or later |`,
    `| macOS — Intel | ${download(names.macX64Dmg)} | macOS 13+, Intel-based Macs |`,
    `| Windows | ${download(names.windowsSetup)} | Intel/AMD 64-bit installer |`,
    `| Linux — AppImage | ${download(names.linuxAppImage)} | Intel/AMD 64-bit, portable |`,
    `| Linux — Debian/Ubuntu | ${download(names.linuxDeb)} | Intel/AMD 64-bit package |`,
    `| Linux — Fedora/RHEL/openSUSE | ${download(names.linuxRpm)} | Intel/AMD 64-bit package |`,
    "",
    "## Updating",
    "",
    "In the app, choose **Download update**, continue using PixivBiu, then choose **Restart & update** when ready. Windows installs silently and reopens, with UAC authorization when required. Ordinary exit does not install. A desktop client predating this flow may still show the installer wizard once while upgrading to the first fixed version.",
    "",
    "For Debian/Ubuntu or Fedora/RHEL/openSUSE packages, download the corresponding package above, fully quit PixivBiu, upgrade with the system package installer or package manager, and reopen. PixivBiu does not provide an apt/yum repository.",
    "",
    "## Build information",
    "",
    `- Desktop version: \`v${info.version}\``,
    `- Release channel: ${info.channel[0].toUpperCase()}${info.channel.slice(1)}`,
    `- Source tag: [\`${info.tag}\`](https://github.com/${sourceRepository}/tree/${encodeURIComponent(info.tag)})`,
    `- Bundled Core: [\`${coreVersion}\`](https://github.com/${sourceRepository}/releases/tag/${encodeURIComponent(coreVersion)})`,
    "",
    "## Other assets",
    "",
    "Files ending in `.zip` or `.blockmap`, together with `latest*.yml`, are used by the automatic updater and normally do not need to be downloaded manually.",
    "",
  );

  return lines.join("\n");
}

export function verifyRelease({
  tag,
  coreVersion,
  sourceRepository,
  desktopRepository,
  assets,
  metadata,
  changelog,
}) {
  const info = parseDesktopTag(tag);
  if (!Array.isArray(assets) || assets.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("release asset manifest must be an array of non-empty filenames");
  }

  const duplicates = assets.filter((name, index) => assets.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`release asset manifest contains duplicate names: ${[...new Set(duplicates)].join(", ")}`);
  }
  const legacyAliases = assets.filter((name) => name.startsWith("PixivBiu-latest-"));
  if (legacyAliases.length > 0) {
    throw new Error(`release contains retired latest aliases: ${legacyAliases.join(", ")}`);
  }

  const names = artifactNames(info.version);
  const metadataNames = ["latest-mac.yml", "latest.yml", "latest-linux.yml"];
  const blockmaps = [
    `${names.macArmDmg}.blockmap`,
    `${names.macX64Dmg}.blockmap`,
    `${names.macArmZip}.blockmap`,
    `${names.macX64Zip}.blockmap`,
    `${names.windowsSetup}.blockmap`,
  ];
  const requiredAssets = [...Object.values(names), ...metadataNames, ...blockmaps];
  const assetSet = new Set(assets);
  const missing = requiredAssets.filter((name) => !assetSet.has(name));
  if (missing.length > 0) {
    throw new Error(`desktop release is missing required assets: ${missing.join(", ")}`);
  }
  const requiredAssetSet = new Set(requiredAssets);
  const unexpected = assets.filter((name) => !requiredAssetSet.has(name));
  if (unexpected.length > 0) {
    throw new Error(`desktop release contains unexpected assets: ${unexpected.join(", ")}`);
  }

  const expectedMetadata = {
    "latest-mac.yml": [names.macX64Zip, names.macArmZip, names.macX64Dmg, names.macArmDmg],
    "latest.yml": [names.windowsSetup],
    "latest-linux.yml": [names.linuxAppImage, names.linuxDeb, names.linuxRpm],
  };

  for (const filename of metadataNames) {
    if (typeof metadata[filename] !== "string") {
      throw new Error(`missing downloaded update metadata ${filename}`);
    }
    const parsed = parseUpdateMetadata(metadata[filename], filename);
    // Without embedded notes electron-updater falls back to scraping the whole
    // release page (downloads table included) from the GitHub Atom feed.
    if (!/^releaseNotes:/m.test(metadata[filename])) {
      throw new Error(`${filename} has no releaseNotes; package with -c.releaseInfo.releaseNotesFile`);
    }
    if (parsed.version !== info.version) {
      throw new Error(`${filename} version is ${JSON.stringify(parsed.version)}; expected ${JSON.stringify(info.version)}`);
    }
    assertExactMembers(parsed.urls, expectedMetadata[filename], `${filename} files`);
    const unavailable = parsed.urls.filter((name) => !assetSet.has(name));
    if (unavailable.length > 0) {
      throw new Error(`${filename} references unavailable assets: ${unavailable.join(", ")}`);
    }
  }

  return {
    info,
    notes: renderReleaseNotes(info, coreVersion, sourceRepository, desktopRepository, changelog),
  };
}

function usage() {
  return [
    "usage:",
    "  node scripts/desktop-release.mjs title <desktop-tag>",
    "  node scripts/desktop-release.mjs notes <desktop-tag> <source-repo> <changelog-output>",
    "  node scripts/desktop-release.mjs verify <desktop-tag> <core-version> <source-repo> <desktop-repo> <assets-json> <metadata-dir> <changelog> <notes-output>",
  ].join("\n");
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "title" && args.length === 1) {
    process.stdout.write(`${parseDesktopTag(args[0]).title}\n`);
    return;
  }

  if (command === "notes" && args.length === 3) {
    const [tag, sourceRepository, outputPath] = args;
    fs.writeFileSync(outputPath, generateChangelog({ tag, sourceRepository }), "utf8");
    process.stdout.write(`wrote changelog for ${tag} to ${outputPath}\n`);
    return;
  }

  if (command === "verify" && args.length === 8) {
    const [tag, coreVersion, sourceRepository, desktopRepository, assetsPath, metadataDir, changelogPath, notesPath] = args;
    const assets = JSON.parse(fs.readFileSync(assetsPath, "utf8"));
    const metadata = Object.fromEntries(
      ["latest-mac.yml", "latest.yml", "latest-linux.yml"].map((filename) => [
        filename,
        fs.readFileSync(path.join(metadataDir, filename), "utf8"),
      ]),
    );
    const result = verifyRelease({
      tag,
      coreVersion,
      sourceRepository,
      desktopRepository,
      assets,
      metadata,
      changelog: fs.readFileSync(changelogPath, "utf8"),
    });
    fs.writeFileSync(notesPath, result.notes, "utf8");
    process.stdout.write(`verified ${assets.length} assets for ${result.info.title}\n`);
    return;
  }

  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`desktop release validation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
