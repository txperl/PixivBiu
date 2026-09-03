#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const desktopTagPattern =
  /^desktop-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/;
const coreTagPattern =
  /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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
    prerelease: channel !== "stable",
    title: `PixivBiu Desktop v${version}${channelLabel}`,
  };
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

export function renderReleaseNotes(info, coreVersion, sourceRepository, desktopRepository) {
  if (!coreTagPattern.test(coreVersion)) {
    throw new Error(`invalid bundled core version ${JSON.stringify(coreVersion)}; expected a v-prefixed SemVer tag`);
  }
  assertRepository(sourceRepository, "source");
  assertRepository(desktopRepository, "desktop release");

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
    "## Downloads",
    "",
    "| Platform | Download | Notes |",
    "| --- | --- | --- |",
    `| macOS — Apple silicon | ${download(names.macArmDmg)} | M1 or later |`,
    `| macOS — Intel | ${download(names.macX64Dmg)} | Intel-based Macs |`,
    `| Windows | ${download(names.windowsSetup)} | Intel/AMD 64-bit installer |`,
    `| Linux — AppImage | ${download(names.linuxAppImage)} | Intel/AMD 64-bit, portable |`,
    `| Linux — Debian/Ubuntu | ${download(names.linuxDeb)} | Intel/AMD 64-bit package |`,
    `| Linux — Fedora/RHEL/openSUSE | ${download(names.linuxRpm)} | Intel/AMD 64-bit package |`,
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
    notes: renderReleaseNotes(info, coreVersion, sourceRepository, desktopRepository),
  };
}

function usage() {
  return [
    "usage:",
    "  node scripts/desktop-release.mjs title <desktop-tag>",
    "  node scripts/desktop-release.mjs verify <desktop-tag> <core-version> <source-repo> <desktop-repo> <assets-json> <metadata-dir> <notes-output>",
  ].join("\n");
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "title" && args.length === 1) {
    process.stdout.write(`${parseDesktopTag(args[0]).title}\n`);
    return;
  }

  if (command === "verify" && args.length === 7) {
    const [tag, coreVersion, sourceRepository, desktopRepository, assetsPath, metadataDir, notesPath] = args;
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
