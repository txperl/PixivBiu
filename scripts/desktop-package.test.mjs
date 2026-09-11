import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { finished } from "node:stream/promises";
import test from "node:test";

const require = createRequire(new URL("../desktop/package.json", import.meta.url));
const asar = createRequire(require.resolve("app-builder-lib/package.json"))("@electron/asar");
const { languages, verifyAsar, verifyBinary, verifyLocales, verifyPackage, measurePackage, recordPackage, packages } = require("./build/package-audit.cjs");
const reportPackages = require("./build/package-report.cjs").default;

function fixture(t, platform = "linux") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-package-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appRoot = path.join(root, "app");
  const resources = path.join(appRoot, platform === "darwin" ? "Contents/Resources" : "resources");
  const locales = path.join(appRoot, "locales");
  const layout = { platform, arch: "x64", appRoot, resources, localeDirectories: [locales], localeExtension: platform === "darwin" ? ".lproj" : ".pak" };
  const write = (file, data = "fixture") => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };
  for (const locale of ["en-US", "zh-CN", "zh-TW", "ja"]) {
    write(path.join(locales, platform === "darwin" ? `${locale.replaceAll("-", "_")}.lproj/locale.pak` : `${locale}.pak`));
  }
  for (const name of ["icon.png", "icon.ico", "app-update.yml"]) write(path.join(resources, name));
  for (const name of ["LICENSE.electron.txt", "LICENSES.chromium.html"]) write(path.join(platform === "darwin" ? resources : appRoot, name));
  const core = Buffer.alloc(128);
  core.write("pixivbiu-desktop/1", 96);
  if (platform === "darwin") { core.writeUInt32LE(0xfeedfacf); core.writeUInt32LE(0x01000007, 4); }
  else if (platform === "win32") { core.write("MZ"); core.writeUInt32LE(64, 0x3c); core.write("PE\0\0", 64); core.writeUInt16LE(0x8664, 68); }
  else { Buffer.from("7f454c460201", "hex").copy(core); core.writeUInt16LE(62, 18); }
  const corePath = path.join(resources, platform === "win32" ? "pixivbiu.exe" : "pixivbiu");
  write(corePath, core);
  const source = path.join(root, "source");
  const json = (file, value) => write(path.join(source, file), JSON.stringify(value));
  json("package.json", { version: "1.2.3", main: "dist/main.js", dependencies: { "electron-updater": "1.0.0" } });
  write(path.join(source, "dist/main.js"));
  write(path.join(source, "dist/preload.js"));
  json("node_modules/electron-updater/package.json", { main: "index.js", dependencies: { helper: "1.0.0" } });
  write(path.join(source, "node_modules/electron-updater/index.js"));
  json("node_modules/helper/package.json", { main: "index.js" });
  write(path.join(source, "node_modules/helper/index.js"));
  const archive = path.join(resources, "app.asar");
  // The locked ASAR writer returns its stream before the final writes finish.
  const pack = async () => { asar.uncache(archive); await finished(await asar.createPackage(source, archive)); };
  return { root, layout, write, source, pack, archive, corePath };
}

test("package audit accepts the platform layouts and rejects a mismatched core", async t => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const f = fixture(t, platform);
    await f.pack();
    verifyPackage(f.layout);
    assert.throws(() => verifyBinary(f.corePath, platform, "arm64"), /CPU mismatch/);
    f.write(path.join(f.layout.resources, "nested", path.basename(f.corePath)));
    assert.throws(() => verifyPackage(f.layout), /exactly one core/);
  }
});

test("ASAR audit resolves nested scoped dependencies on the host platform", async t => {
  const f = fixture(t);
  const nested = path.join(f.source, "node_modules/electron-updater/node_modules/@fixture/helper");
  f.write(path.join(f.source, "node_modules/electron-updater/package.json"),
    JSON.stringify({ main: "index.js", dependencies: { "@fixture/helper": "1.0.0" } }));
  f.write(path.join(nested, "package.json"), JSON.stringify({ main: "lib/index.js" }));
  f.write(path.join(nested, "lib/index.js"));
  await f.pack();
  assert.equal(verifyAsar(f.archive).version, "1.2.3");

  fs.unlinkSync(path.join(nested, "lib/index.js"));
  await f.pack();
  assert.throws(() => verifyAsar(f.archive), /Missing package entry/);
});

test("package audit refuses a core predating the managed lifecycle protocol", t => {
  const f = fixture(t);
  const data = fs.readFileSync(f.corePath);
  data.fill(0, 96);
  fs.writeFileSync(f.corePath, data);
  assert.throws(() => verifyBinary(f.corePath, "linux", "x64"), /lacks desktop lifecycle protocol/);
});

test("locale audit covers platform names, variants, missing fallback and empty packs", t => {
  const f = fixture(t, "darwin");
  f.write(path.join(f.layout.localeDirectories[0], "zh_CN_FEMININE.lproj/locale.pak"));
  verifyLocales(f.layout);
  fs.rmSync(path.join(f.layout.localeDirectories[0], "en_US.lproj"), { recursive: true });
  assert.throws(() => verifyLocales(f.layout), /Missing Electron language: en/);
  const linux = fixture(t);
  linux.write(path.join(linux.layout.localeDirectories[0], "de.pak"));
  assert.throws(() => verifyLocales(linux.layout), /Unexpected Electron language/);
  fs.unlinkSync(path.join(linux.layout.localeDirectories[0], "de.pak"));
  linux.write(path.join(linux.layout.localeDirectories[0], "ja.pak"), "");
  assert.throws(() => verifyLocales(linux.layout), /Missing Electron language: ja/);
});

test("ASAR audit rejects leaked inputs and missing entries or transitive dependencies", async t => {
  for (const file of [".core-version", "resources/pixivbiu", "build/script.js", "out/previous.zip", "dist/main.js.map", "node_modules/helper/index.d.ts"]) {
    const f = fixture(t);
    f.write(path.join(f.source, file));
    await f.pack();
    assert.throws(() => verifyAsar(f.archive), /ASAR payload/);
  }
  for (const file of ["dist/preload.js", "node_modules/electron-updater/index.js", "node_modules/helper/package.json"]) {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.source, file));
    await f.pack();
    assert.throws(() => verifyAsar(f.archive), /Missing/);
  }
});

test("reports count logical bytes without symlink duplication and never publish diagnostics", async t => {
  const f = fixture(t);
  t.mock.method(console, "log", () => {});
  const previousSummary = process.env.GITHUB_STEP_SUMMARY;
  process.env.GITHUB_STEP_SUMMARY = path.join(f.root, "step-summary.md");
  t.after(() => {
    if (previousSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
    else process.env.GITHUB_STEP_SUMMARY = previousSummary;
  });
  await f.pack();
  const initial = measurePackage(f.layout);
  if (process.platform !== "win32") {
    fs.symlinkSync(f.layout.resources, path.join(f.layout.appRoot, "resource-link"));
    assert.equal(measurePackage(f.layout).expandedBytes, initial.expandedBytes);
  }
  const artifact = path.join(f.root, "PixivBiu-Desktop-1.2.3-linux-amd64.deb");
  f.write(artifact);
  packages.set("linux-x64", { layout: f.layout, version: "1.2.3", electronVersion: "44.1.1", corePin: "v3.1.1", coreReleaseVersion: null });
  t.after(() => packages.clear());
  assert.deepEqual(reportPackages({ outDir: f.root, artifactPaths: [artifact] }), []);
  const report = JSON.parse(fs.readFileSync(path.join(f.root, "size-reports/linux-x64.json")));
  assert.equal(report.expandedBytes, initial.expandedBytes);
  assert.equal(report.coreReleaseVersion, null);
  assert.deepEqual(report.artifacts, [{ name: path.basename(artifact), bytes: 7 }]);
  assert.match(fs.readFileSync(process.env.GITHUB_STEP_SUMMARY, "utf8"), /Logical bytes/);
});

test("afterPack checks the staged core before signing and report failures propagate", async t => {
  const f = fixture(t);
  await f.pack();
  f.write(path.join(f.root, ".core-version"), "v3.1.1");
  const staged = path.join(f.root, "resources/x64/pixivbiu");
  f.write(staged, fs.readFileSync(f.corePath));
  const context = { electronPlatformName: "linux", arch: require("builder-util").Arch.x64, appOutDir: f.layout.appRoot, packager: {
    projectDir: f.root, getResourcesDir: () => f.layout.resources, info: { framework: { version: "44.1.1" } },
  } };
  t.after(() => packages.clear());
  recordPackage(context);
  assert.ok(packages.get("linux-x64").stagedCoreSha256);
  fs.appendFileSync(staged, "changed");
  assert.throws(() => recordPackage(context), /differs from staged core/);
  fs.unlinkSync(path.join(f.layout.resources, "app-update.yml"));
  assert.throws(() => reportPackages({ outDir: f.root, artifactPaths: [] }), /Missing or empty regular file/);
});

test("packaged languages stay aligned with the SPA and audit hooks stay enabled", () => {
  const config = require("js-yaml").load(fs.readFileSync(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8"));
  const inlang = JSON.parse(fs.readFileSync(new URL("../frontend/src/i18n/project.inlang/settings.json", import.meta.url)));
  assert.deepEqual(config.electronLanguages, languages);
  assert.deepEqual(languages, inlang.locales);
  assert.equal(config.afterPack, "build/after-pack.cjs");
  assert.equal(config.afterAllArtifactBuild, "build/package-report.cjs");
});
