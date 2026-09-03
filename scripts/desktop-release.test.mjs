import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactNames,
  parseDesktopTag,
  renderReleaseNotes,
  verifyRelease,
} from "./desktop-release.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixture(tag = "desktop-v1.2.0", coreVersion = "v3.1.0-alpha.1") {
  const info = parseDesktopTag(tag);
  const names = artifactNames(info.version);
  const metadata = {
    "latest-mac.yml": `version: ${info.version}\nfiles:\n  - url: ${names.macX64Zip}\n  - url: ${names.macArmZip}\n  - url: ${names.macX64Dmg}\n  - url: ${names.macArmDmg}\n`,
    "latest.yml": `version: ${info.version}\nfiles:\n  - url: ${names.windowsSetup}\n`,
    "latest-linux.yml": `version: ${info.version}\nfiles:\n  - url: ${names.linuxAppImage}\n  - url: ${names.linuxDeb}\n  - url: ${names.linuxRpm}\n`,
  };
  const assets = [
    ...Object.values(names),
    "latest-mac.yml",
    "latest.yml",
    "latest-linux.yml",
    `${names.macArmDmg}.blockmap`,
    `${names.macX64Dmg}.blockmap`,
    `${names.macArmZip}.blockmap`,
    `${names.macX64Zip}.blockmap`,
    `${names.windowsSetup}.blockmap`,
  ];
  return {
    tag,
    coreVersion,
    sourceRepository: "txperl/PixivBiu",
    desktopRepository: "txperl/PixivBiu-Desktop",
    assets,
    metadata,
  };
}

test("desktop release titles cover stable, alpha, and beta channels", () => {
  assert.equal(parseDesktopTag("desktop-v1.2.0").title, "PixivBiu Desktop v1.2.0");
  assert.equal(
    parseDesktopTag("desktop-v1.2.0-alpha.3").title,
    "PixivBiu Desktop v1.2.0-alpha.3 (Alpha)",
  );
  assert.equal(
    parseDesktopTag("desktop-v1.2.0-beta.2").title,
    "PixivBiu Desktop v1.2.0-beta.2 (Beta)",
  );
});

test("desktop release tags reject unsupported and malformed channels", () => {
  assert.throws(() => parseDesktopTag("desktop-v1.2.0-rc.1"), /invalid desktop release tag/);
  assert.throws(() => parseDesktopTag("desktop-v1.2.0-preview.1"), /invalid desktop release tag/);
  assert.throws(() => parseDesktopTag("desktop-v1.2.0-alpha"), /invalid desktop release tag/);
  assert.throws(() => parseDesktopTag("desktop-v1.2.0-beta.01"), /invalid desktop release tag/);
  assert.throws(() => parseDesktopTag("desktop-v01.2.0"), /invalid desktop release tag/);
});

test("electron-builder artifact templates match the verified release contract", () => {
  const config = fs.readFileSync(path.join(repositoryRoot, "desktop/electron-builder.yml"), "utf8");
  assert.match(config, /artifactName: \$\{productName\}-Desktop-\$\{version\}-darwin-\$\{arch\}\.\$\{ext\}/);
  assert.match(config, /artifactName: \$\{productName\}-Desktop-\$\{version\}-windows-\$\{arch\}-setup\.\$\{ext\}/);
  assert.match(config, /artifactName: \$\{productName\}-Desktop-\$\{version\}-linux-\$\{arch\}\.\$\{ext\}/);
});

test("desktop toolchain and package hardening stay on the supported contract", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "desktop/package.json"), "utf8"),
  );
  assert.equal(manifest.homepage, "https://biu.tls.moe");
  assert.equal(manifest.desktopName, "moe.tls.pixivbiu");
  assert.equal(manifest.engines.node, ">=22.12.0");
  assert.equal(manifest.devDependencies.electron, "^44.1.1");
  assert.equal(manifest.devDependencies["@types/node"], "^24.13.3");

  const config = fs.readFileSync(path.join(repositoryRoot, "desktop/electron-builder.yml"), "utf8");
  assert.match(config, /electronFuses:\n(?: {2}.+\n)+/);
  for (const fuse of [
    "runAsNode: false",
    "enableCookieEncryption: true",
    "enableNodeOptionsEnvironmentVariable: false",
    "enableNodeCliInspectArguments: false",
    "enableEmbeddedAsarIntegrityValidation: true",
    "onlyLoadAppFromAsar: true",
    "grantFileProtocolExtraPrivileges: false",
  ]) {
    assert.ok(config.includes(`  ${fuse}`), fuse);
  }
  assert.match(config, /minimumSystemVersion: "13\.0"/);
  assert.match(config, /syncDesktopName: true/);
  assert.match(config, /desktop:\n {4}entry:\n {6}Keywords:/);
});

test("desktop packaging has a real cross-platform application icon", () => {
  const config = fs.readFileSync(path.join(repositoryRoot, "desktop/electron-builder.yml"), "utf8");
  assert.equal(config.match(/^\s+icon: icon\.icns$/gm)?.length, 1);
  assert.equal(config.match(/^\s+icon: icon\.ico$/gm)?.length, 1);
  assert.equal(config.match(/^\s+icon: icon\.png$/gm)?.length, 1);
  assert.match(config, /from: build\/icon\.png\n\s+to: icon\.png/);
  assert.match(config, /from: build\/icon\.ico\n\s+to: icon\.ico/);

  const icon = fs.readFileSync(path.join(repositoryRoot, "desktop/build/icon.png"));
  assert.deepEqual(icon.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);
  assert.equal(width, height);
  assert.ok(width >= 512, `icon must be at least 512x512, got ${width}x${height}`);

  const macIcon = fs.readFileSync(path.join(repositoryRoot, "desktop/build/icon.icns"));
  assert.equal(macIcon.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(macIcon.readUInt32BE(4), macIcon.length);

  const windowsIcon = fs.readFileSync(path.join(repositoryRoot, "desktop/build/icon.ico"));
  assert.deepEqual(windowsIcon.subarray(0, 4), Buffer.from([0x00, 0x00, 0x01, 0x00]));
  assert.ok(windowsIcon.readUInt16LE(4) >= 1, "Windows ICO must contain at least one image");
});

test("release notes use user-facing platform names and traceable build links", () => {
  const info = parseDesktopTag("desktop-v1.2.0-alpha.1");
  const notes = renderReleaseNotes(
    info,
    "v3.1.0-alpha.1",
    "txperl/PixivBiu",
    "txperl/PixivBiu-Desktop",
  );

  assert.match(notes, /This is an Alpha preview/);
  assert.match(notes, /macOS — Apple silicon/);
  assert.match(notes, /macOS 13\+/);
  assert.match(notes, /PixivBiu-Desktop-1\.2\.0-alpha\.1-darwin-arm64\.dmg/);
  assert.match(notes, /\/tree\/desktop-v1\.2\.0-alpha\.1/);
  assert.match(notes, /\/releases\/tag\/v3\.1\.0-alpha\.1/);
  assert.doesNotMatch(notes, /darwin —/);
});

test("a complete release verifies and renders notes", () => {
  const result = verifyRelease(fixture("desktop-v1.2.0-beta.1"));
  assert.equal(result.info.channel, "beta");
  assert.match(result.notes, /This is a Beta preview/);
  assert.match(result.notes, /PixivBiu-Desktop-1\.2\.0-beta\.1-windows-x64-setup\.exe/);

  const stable = verifyRelease(fixture("desktop-v1.2.0"));
  assert.doesNotMatch(stable.notes, /\[!WARNING\]/);
});

test("verification refuses missing and duplicate assets", () => {
  const missing = fixture();
  missing.assets = missing.assets.filter((name) => !name.endsWith("-darwin-arm64.dmg"));
  assert.throws(() => verifyRelease(missing), /missing required assets/);

  const duplicate = fixture();
  duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => verifyRelease(duplicate), /duplicate names/);

  const stale = fixture();
  stale.assets.push("PixivBiu-1.2.0-x64.dmg");
  assert.throws(() => verifyRelease(stale), /unexpected assets/);
});

test("verification refuses retired aliases and metadata drift", () => {
  const aliased = fixture();
  aliased.assets.push("PixivBiu-latest-windows.exe");
  assert.throws(() => verifyRelease(aliased), /retired latest aliases/);

  const wrongVersion = fixture();
  wrongVersion.metadata["latest.yml"] = wrongVersion.metadata["latest.yml"].replace(
    "version: 1.2.0",
    "version: 1.2.1",
  );
  assert.throws(() => verifyRelease(wrongVersion), /version is "1.2.1"/);

  const wrongUrl = fixture();
  wrongUrl.metadata["latest-linux.yml"] = wrongUrl.metadata["latest-linux.yml"].replace(
    ".AppImage",
    "-wrong.AppImage",
  );
  assert.throws(() => verifyRelease(wrongUrl), /latest-linux\.yml files contains/);

  const wrongCore = fixture();
  wrongCore.coreVersion = "not-a-core-tag";
  assert.throws(() => verifyRelease(wrongCore), /invalid bundled core version/);
});
