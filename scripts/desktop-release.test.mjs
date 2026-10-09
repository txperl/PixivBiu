import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactNames,
  changelogEndMarker,
  changelogStartMarker,
  generateChangelog,
  parseCommitSubject,
  parseDesktopTag,
  previousDesktopTag,
  renderChangelog,
  renderReleaseNotes,
  verifyRelease,
} from "./desktop-release.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const changelog = "### Features\n\n- Add a thing\n";

function fixture(tag = "desktop-v1.2.0", coreVersion = "v3.1.0-alpha.1") {
  const info = parseDesktopTag(tag);
  const names = artifactNames(info.version);
  const metadata = {
    "latest-mac.yml": `version: ${info.version}\nfiles:\n  - url: ${names.macX64Zip}\n  - url: ${names.macArmZip}\n  - url: ${names.macX64Dmg}\n  - url: ${names.macArmDmg}\nreleaseNotes: |-\n  ### Features\n`,
    "latest.yml": `version: ${info.version}\nfiles:\n  - url: ${names.windowsSetup}\nreleaseNotes: |-\n  ### Features\n`,
    "latest-linux.yml": `version: ${info.version}\nfiles:\n  - url: ${names.linuxAppImage}\n  - url: ${names.linuxDeb}\n  - url: ${names.linuxRpm}\nreleaseNotes: |-\n  ### Features\n`,
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
    changelog,
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
  assert.match(config, /electronFuses:\r?\n(?: {2}.+\r?\n)+/);
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
  assert.match(config, /desktop:\r?\n {4}entry:\r?\n {6}Keywords:/);
});

test("desktop packaging has a real cross-platform application icon", () => {
  const config = fs.readFileSync(path.join(repositoryRoot, "desktop/electron-builder.yml"), "utf8");
  assert.equal(config.match(/^\s+icon: icon\.icns$/gm)?.length, 1);
  assert.equal(config.match(/^\s+icon: icon\.ico$/gm)?.length, 1);
  assert.equal(config.match(/^\s+icon: icon\.png$/gm)?.length, 1);
  assert.match(config, /from: build\/icon\.png\r?\n\s+to: icon\.png/);
  assert.match(config, /from: build\/icon\.ico\r?\n\s+to: icon\.ico/);

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
    changelog,
  );

  assert.match(notes, /This is an Alpha preview/);
  assert.ok(notes.includes(`${changelogStartMarker}\n\n### Features\n\n- Add a thing\n\n${changelogEndMarker}`));
  assert.ok(notes.indexOf(changelogEndMarker) < notes.indexOf("## Downloads"));
  assert.match(notes, /macOS — Apple silicon/);
  assert.match(notes, /macOS 13\+/);
  assert.match(notes, /PixivBiu-Desktop-1\.2\.0-alpha\.1-darwin-arm64\.dmg/);
  assert.match(notes, /\/tree\/desktop-v1\.2\.0-alpha\.1/);
  assert.match(notes, /\/releases\/tag\/v3\.1\.0-alpha\.1/);
  assert.doesNotMatch(notes, /darwin —/);
  assert.match(notes, /Download update/);
  assert.match(notes, /Ordinary exit does not install/);
  assert.match(notes, /installer wizard once/);
  assert.match(notes, /does not provide an apt\/yum repository/);
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

  const noNotes = fixture();
  noNotes.metadata["latest-mac.yml"] = noNotes.metadata["latest-mac.yml"].replace(/releaseNotes:[\s\S]*$/, "");
  assert.throws(() => verifyRelease(noNotes), /latest-mac\.yml has no releaseNotes/);

  const emptyChangelog = fixture();
  emptyChangelog.changelog = "  \n";
  assert.throws(() => verifyRelease(emptyChangelog), /changelog must be non-empty/);

  const wrongCore = fixture();
  wrongCore.coreVersion = "not-a-core-tag";
  assert.throws(() => verifyRelease(wrongCore), /invalid bundled core version/);
});

test("changelog baselines: stable compares to stable, prereleases to any lower tag", () => {
  const tags = [
    "desktop-v1.0.0-alpha.1",
    "desktop-v1.0.0",
    "desktop-v1.0.1",
    "desktop-v1.1.0-alpha.1",
    "desktop-v1.1.0-beta.1",
    "desktop-v1.1.0-beta.2",
    "desktop-vnot-a-tag",
  ];
  assert.equal(previousDesktopTag("desktop-v1.1.0", tags), "desktop-v1.0.1");
  assert.equal(previousDesktopTag("desktop-v1.1.0-beta.2", tags), "desktop-v1.1.0-beta.1");
  assert.equal(previousDesktopTag("desktop-v1.1.0-alpha.1", tags), "desktop-v1.0.1");
  assert.equal(previousDesktopTag("desktop-v1.0.0", tags), undefined);
  assert.equal(previousDesktopTag("desktop-v1.0.0-alpha.1", tags), undefined);
});

test("conventional subjects parse type, scope, and breaking marker", () => {
  assert.deepEqual(parseCommitSubject("feat(desktop)!: drop legacy flag"), {
    type: "feat",
    scope: "desktop",
    breaking: true,
    description: "drop legacy flag",
  });
  assert.equal(parseCommitSubject("fix: plain").scope, "");
  assert.equal(parseCommitSubject("Update README"), undefined);
});

test("changelog groups user-facing changes and never renders empty", () => {
  const commit = (subject) => parseCommitSubject(subject);
  const notes = renderChangelog({
    highlights: "A big one.",
    commits: [
      commit("fix: repair b"),
      commit("feat(desktop): add a"),
      commit("chore(desktop): pin core"),
      commit("perf: faster c"),
      commit("feat!: remove d"),
      commit("feat(desktop): add a"),
    ],
    coreChange: { from: "v3.1.2", to: "v3.1.3", repository: "txperl/PixivBiu" },
  });
  assert.equal(
    notes,
    [
      "### Highlights\n\nA big one.",
      "### Features\n\n- Add a\n- **Breaking:** Remove d",
      "### Bug fixes\n\n- Repair b",
      "### Performance\n\n- Faster c",
      "Bundled core updated from `v3.1.2` to [`v3.1.3`](https://github.com/txperl/PixivBiu/releases/tag/v3.1.3).\n",
    ].join("\n\n"),
  );
  assert.equal(renderChangelog({}), "Maintenance release with internal improvements.\n");
  assert.equal(renderChangelog({ initial: true }), "Initial release.\n");
});

test("changelog generation reads desktop and pinned-core history from git", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-changelog-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const commit = (subject, core) => {
    if (core) {
      fs.mkdirSync(path.join(dir, "desktop"), { recursive: true });
      fs.writeFileSync(path.join(dir, "desktop/.core-version"), `${core}\n`);
      git("add", "-A");
    }
    git("commit", "--allow-empty", "-q", "-m", subject);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");

  commit("feat: core one");
  git("tag", "v3.1.0");
  commit("chore(desktop): pin core to v3.1.0", "v3.1.0");
  git("tag", "desktop-v1.0.0");
  commit("feat(desktop): shell feature");
  commit("fix(frontend): core fix");
  commit("feat(desktop): core-side desktop commit");
  commit("docs: core docs");
  git("tag", "v3.1.1");
  commit("chore(desktop): pin core to v3.1.1", "v3.1.1");
  git("tag", "-a", "desktop-v1.0.1", "-m", "Big release.\n\nDetails here.");
  commit("fix(desktop): only shell");
  git("tag", "desktop-v1.0.2");

  const first = generateChangelog({ tag: "desktop-v1.0.0", sourceRepository: "txperl/PixivBiu", cwd: dir });
  assert.match(first, /^Initial release\./);
  assert.match(first, /Bundles core \[`v3\.1\.0`\]/);

  const second = generateChangelog({ tag: "desktop-v1.0.1", sourceRepository: "txperl/PixivBiu", cwd: dir });
  assert.match(second, /^### Highlights\n\nBig release\.\n\nDetails here\./);
  assert.match(second, /### Features\n\n- Shell feature\n- Core-side desktop commit\n/);
  assert.match(second, /### Bug fixes\n\n- Core fix\n/);
  assert.doesNotMatch(second, /Core docs|Pin core/);
  assert.match(second, /Bundled core updated from `v3\.1\.0` to \[`v3\.1\.1`\]/);

  const third = generateChangelog({ tag: "desktop-v1.0.2", sourceRepository: "txperl/PixivBiu", cwd: dir });
  assert.equal(third, "### Bug fixes\n\n- Only shell\n");
});

test("release-notes markers match the desktop updater's stitching contract", () => {
  const notes = require("../desktop/dist/release-notes.js");
  assert.equal(notes.CHANGELOG_START, changelogStartMarker);
  assert.equal(notes.CHANGELOG_END, changelogEndMarker);
});
