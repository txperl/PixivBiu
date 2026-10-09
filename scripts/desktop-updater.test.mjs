import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { UpdateController } = require("../desktop/dist/update-controller.js");
const { UpdateStore, verifyPending } = require("../desktop/dist/update-store.js");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-update-test-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const format = options.format ?? "nsis";
    const file = path.join(dir, format === "mac" ? "Desktop.zip" : format === "appimage" ? "Desktop.AppImage" : "Desktop.exe");
    fs.writeFileSync(file, "synthetic cached update");
    const sha512 = createHash("sha512").update(fs.readFileSync(file)).digest("base64");
    const info = { version: "1.1.0", releaseDate: "2026-10-09T00:00:00Z", files: [{ url: path.basename(file), sha512 }], releaseNotes: "Latest notes" };
    const pending = { version: info.version, format, file, sha512 };
    const record = path.join(dir, "update-state.json");
    const sent = [], logs = [], counts = { check: 0, download: 0, stop: 0, resume: 0, install: 0 };
    const driver = Object.assign(new EventEmitter(), {
        async checkForUpdates() { counts.check++; return { isUpdateAvailable: true, updateInfo: info }; },
        async downloadUpdate() {
            counts.download++;
            driver.emit("download-progress", { percent: 56.6 });
            driver.emit("update-downloaded", { ...info, downloadedFile: file });
            return format === "mac" ? [] : [file];
        },
        quitAndInstall(...args) { counts.install++; assert.deepEqual(args, [true, true]); },
    });
    const settings = {
        currentVersion: "1.0.0", format, packaged: true, store: new UpdateStore(record),
        async prepareQuit() { counts.stop++; }, resume() { counts.resume++; },
        send: snapshot => sent.push(snapshot), log: (...event) => logs.push(event),
        links: async () => ({ releaseUrl: "https://example.invalid/releases/v1.1.0" }), notes: async () => undefined,
        appImageFile: file, ...options,
    };
    const controller = new UpdateController(driver, settings);
    return { dir, file, info, pending, record, sent, logs, counts, driver, settings, controller,
        restore(extra = {}) { return new UpdateController(driver, { ...settings, store: new UpdateStore(record), ...extra }); } };
}

test("checks and background downloads coalesce, publish snapshots and never stop Core", async t => {
    const f = fixture(t);
    assert.equal(f.driver.autoDownload, false);
    assert.equal(f.driver.autoInstallOnAppQuit, false);
    const first = f.controller.check();
    assert.equal(first, f.controller.check());
    await first;
    const download = f.controller.download();
    assert.equal(download, f.controller.download());
    await download;
    assert.equal(f.controller.read().state, "downloaded");
    assert.equal(f.controller.read().readyToInstall, true);
    assert.deepEqual(f.counts, { check: 1, download: 1, stop: 0, resume: 0, install: 0 });
    assert.ok(f.sent.some(s => s.state === "downloading" && s.percent === 57));
    assert.ok(f.sent.every((s, i) => i === 0 || s.sequence > f.sent[i - 1].sequence));
    const copy = f.controller.read(); copy.state = "installing";
    assert.equal(f.controller.read().state, "downloaded");
    f.controller.beginQuit();
    assert.equal(f.counts.install, 0, "ordinary quit never installs a downloaded update");
});

test("explicit restart coalesces and waits for the Core barrier before silent installation", async t => {
    const f = fixture(t); const barrier = deferred(); const entered = deferred();
    f.settings.prepareQuit = async () => { f.counts.stop++; entered.resolve(); await barrier.promise; };
    await f.controller.check(); await f.controller.download();
    const restart = f.controller.restartAndInstall();
    assert.equal(restart, f.controller.restartAndInstall());
    await entered.promise;
    assert.equal(f.controller.read().state, "preparing-install");
    assert.equal(f.counts.stop, 1); assert.equal(f.counts.install, 0);
    barrier.resolve(); await restart;
    assert.equal(f.counts.install, 1);
    assert.equal(f.controller.read().state, "installing");
    f.controller.beginQuit();
    assert.equal(f.controller.read().state, "installing", "installer owns its explicit quit");
});

test("legacy combined method remains compatible and duplicate calls install once", async t => {
    const f = fixture(t); await f.controller.check();
    await Promise.all([f.controller.downloadAndInstall(), f.controller.downloadAndInstall()]);
    assert.equal(f.counts.stop, 1); assert.equal(f.counts.install, 1);
});

test("restart before download is refused without stopping Core", async t => {
    const f = fixture(t); await f.controller.check();
    await assert.rejects(f.controller.restartAndInstall(), /verification_failed/);
    assert.equal(f.counts.stop, 0); assert.equal(f.counts.install, 0);
});

test("macOS caches the event's ZIP even when downloadUpdate resolves with an empty array", async t => {
    const f = fixture(t, { format: "mac" }); await f.controller.check(); await f.controller.download();
    assert.deepEqual(new UpdateStore(f.record).pending, f.pending);
    const restored = f.restore(); await restored.check();
    assert.equal(restored.read().state, "downloaded"); assert.equal(f.counts.download, 1);
});

test("online startup restores verified cache without downloading; offline startup keeps installation closed", async t => {
    const f = fixture(t); await f.controller.check(); await f.controller.download();
    const restored = f.restore();
    assert.equal(restored.read().readyToInstall, undefined);
    await restored.check();
    assert.equal(restored.read().readyToInstall, true); assert.equal(f.counts.download, 1);
    f.driver.checkForUpdates = async () => { throw new Error("offline"); };
    const offline = f.restore(); await assert.rejects(offline.check(), /check_failed/);
    assert.equal(offline.read().readyToInstall, false);
    await assert.rejects(offline.restartAndInstall(), /verification_failed/);
    assert.ok(new UpdateStore(f.record).pending, "retain the index for a later online check");
});

for (const scenario of ["missing", "tampered", "version changed", "withdrawn", "checksum changed"]) {
    test(`startup invalidates ${scenario} cache without redownloading`, async t => {
        const f = fixture(t); await f.controller.check(); await f.controller.download();
        if (scenario === "missing") fs.unlinkSync(f.file);
        if (scenario === "tampered") fs.writeFileSync(f.file, "tampered");
        if (scenario === "version changed") f.info.version = "1.2.0";
        if (scenario === "checksum changed") f.info.files[0].sha512 = "different trusted feed digest";
        if (scenario === "withdrawn") f.driver.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: f.info });
        const restored = f.restore(); await restored.check();
        assert.equal(restored.read().state, scenario === "withdrawn" ? "not-available" : "available");
        assert.equal(restored.read().readyToInstall, false);
        assert.equal(new UpdateStore(f.record).pending, undefined); assert.equal(f.counts.download, 1);
    });
}

test("cache tampering just before restart is rejected before the Core barrier", async t => {
    const f = fixture(t); await f.controller.check(); await f.controller.download(); fs.writeFileSync(f.file, "changed");
    await assert.rejects(f.controller.restartAndInstall(), /verification_failed/);
    assert.equal(f.counts.stop, 0); assert.equal(f.controller.read().readyToInstall, false);
});

test("AppImage preflight failure prevents stopping Core or launching replacement", async t => {
    const f = fixture(t, { format: "appimage", appImageFile: "missing-current.AppImage" });
    await f.controller.check(); await f.controller.download();
    await assert.rejects(f.controller.restartAndInstall(), /verification_failed/);
    assert.equal(f.counts.stop, 0); assert.equal(f.counts.install, 0);
});

test("a failed fresh check closes previously downloaded readiness until online revalidation", async t => {
    const f = fixture(t); await f.controller.check(); await f.controller.download();
    const check = f.driver.checkForUpdates;
    f.driver.checkForUpdates = async () => { throw new Error("offline"); };
    await assert.rejects(f.controller.check(), /check_failed/);
    assert.equal(f.controller.read().readyToInstall, false);
    await assert.rejects(f.controller.restartAndInstall(), /verification_failed/);
    assert.equal(f.counts.install, 0); assert.equal(f.counts.stop, 0);
    f.driver.checkForUpdates = check; await f.controller.check();
    assert.equal(f.controller.read().readyToInstall, true); assert.equal(f.counts.download, 1);
});

test("download and Core-stop failures leave the app usable and expose authored errors", async t => {
    const f = fixture(t); await f.controller.check();
    const download = f.driver.downloadUpdate;
    f.driver.downloadUpdate = async () => { throw new Error("private diagnostic"); };
    await assert.rejects(f.controller.download(), /^Error: download_failed$/);
    assert.equal(f.counts.stop, 0);
    f.driver.downloadUpdate = download; await f.controller.download();
    f.settings.prepareQuit = async () => { throw new Error("private stop diagnostic"); };
    await assert.rejects(f.controller.restartAndInstall(), /^Error: stop_failed$/);
    assert.equal(f.counts.install, 0); assert.equal(f.controller.read().readyToInstall, true);
    assert.equal(f.counts.resume, 0, "main owns recovery from a failed stop barrier");
});

for (const failure of ["throw", "synchronous event", "late event"]) {
    test(`installer ${failure} restores Core once and requires a fresh process for retry`, async t => {
        const f = fixture(t); await f.controller.check(); await f.controller.download();
        const install = f.driver.quitAndInstall;
        f.driver.quitAndInstall = () => {
            if (failure === "throw") throw new Error("installer failed");
            if (failure === "synchronous event") f.driver.emit("error", new Error("installer failed"));
        };
        if (failure === "late event") {
            await f.controller.restartAndInstall(); f.driver.emit("error", new Error("late installer error"));
        } else await assert.rejects(f.controller.restartAndInstall(), /install_failed/);
        assert.equal(f.counts.resume, 1); assert.equal(f.controller.read().state, "error");
        f.driver.emit("error", new Error("unrelated error")); assert.equal(f.counts.resume, 1);
        assert.equal(f.controller.read().installRecoveryRequired, true);
        assert.equal(f.controller.read().readyToInstall, false);
        assert.throws(() => f.controller.restartAndInstall(), /install_failed/);
        f.driver.quitAndInstall = install;
        const fresh = f.restore(); await fresh.check(); await fresh.restartAndInstall(); assert.equal(f.counts.install, 1);
    });
}

test("late progress, unrelated completion and release notes cannot regress operation state", async t => {
    const notes = deferred(); const f = fixture(t, { notes: () => notes.promise });
    await f.controller.check(); await f.controller.download();
    const sequence = f.controller.read().sequence;
    f.driver.emit("download-progress", { percent: 2 });
    f.driver.emit("update-available", { version: "0.9.0" });
    f.driver.emit("update-not-available", {});
    f.driver.emit("update-downloaded", { ...f.info, version: "0.9.0", downloadedFile: f.file });
    assert.equal(f.controller.read().sequence, sequence);
    notes.resolve("Stitched notes"); await tick();
    assert.equal(f.controller.read().state, "downloaded"); assert.equal(f.controller.read().notes, "Stitched notes");
});

test("late notes from an older offer do not replace the latest offer", async t => {
    const notes = deferred(); const f = fixture(t, { notes: () => notes.promise }); await f.controller.check();
    f.driver.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: { ...f.info, version: "1.2.0", releaseNotes: "New offer" } });
    f.settings.notes = async () => undefined; await f.controller.check();
    notes.resolve("Old notes"); await tick();
    assert.equal(f.controller.read().version, "1.2.0"); assert.equal(f.controller.read().notes, "New offer");
});

for (const format of ["deb", "rpm", "unsupported"]) {
    test(`${format} offers external updates and rejects in-app actions`, async t => {
        const f = fixture(t, { format }); await f.controller.check();
        assert.equal(f.controller.read().installMode, "external");
        assert.throws(() => f.controller.download(), /not_supported/);
        assert.throws(() => f.controller.restartAndInstall(), /not_supported/);
        await assert.rejects(f.controller.downloadAndInstall(), /not_supported/);
        assert.equal(f.counts.download, 0); assert.equal(f.counts.stop, 0);
    });
}

test("development updates are disabled and cannot execute an installer", async t => {
    const f = fixture(t, { packaged: false }); await f.controller.check();
    assert.equal(f.counts.check, 0); assert.equal(f.controller.read().installMode, "disabled");
    assert.throws(() => f.controller.restartAndInstall(), /not_supported/);
});

for (const phase of ["download", "rehydrate", "stop"]) {
    test(`ordinary quit during ${phase} never falls through to installation`, async t => {
        const f = fixture(t); const gate = deferred(); const entered = deferred(); await f.controller.check();
        if (phase !== "download") await f.controller.download();
        const download = f.driver.downloadUpdate;
        let token;
        if (phase === "stop") f.settings.prepareQuit = async () => { f.counts.stop++; entered.resolve(); await gate.promise; };
        else f.driver.downloadUpdate = async value => { token = value; entered.resolve(); await gate.promise; return download(); };
        const operation = phase === "download" ? f.controller.download() : f.controller.restartAndInstall();
        await entered.promise; f.controller.beginQuit(); gate.resolve();
        await assert.rejects(operation);
        assert.equal(f.counts.install, 0);
        if (phase === "download") assert.equal(token.cancelled, true);
        f.controller.cancelQuit();
        assert.ok(["available", "downloaded"].includes(f.controller.read().state), "cancelled quit restores actionable status");
    });
}

test("installation receipts report success only for the actual target Desktop version", async t => {
    const f = fixture(t); const store = new UpdateStore(f.record); store.savePending(f.pending); store.saveAttempt("1.0.0", "1.1.0");
    const failed = f.restore(); assert.equal(failed.read().previousInstallFailed, true);
    store.saveAttempt("1.0.0", "1.1.0");
    assert.equal(new UpdateStore(f.record).reconcile("1.0.5"), "failed", "a different version is not success");
    store.saveAttempt("1.0.0", "1.1.0");
    assert.equal(new UpdateStore(f.record).reconcile("1.1.0"), "installed");
    assert.equal(new UpdateStore(f.record).pending, undefined);
});

test("cache index rejects malformed records and preserves its last atomic commit after a write failure", t => {
    const f = fixture(t); const store = new UpdateStore(f.record); store.savePending(f.pending);
    fs.renameSync(f.record, f.record + ".saved"); fs.mkdirSync(f.record);
    assert.throws(() => store.savePending(undefined));
    assert.deepEqual(store.pending, f.pending);
    assert.deepEqual(new UpdateStore(f.record + ".saved").pending, f.pending);
    assert.equal(fs.readdirSync(f.dir).some(name => name.endsWith(".tmp")), false);
    fs.rmdirSync(f.record);
    for (const data of ["not json", "x".repeat(16385), '{"schema":2}', '{"schema":1,"pending":{"file":"relative.exe"}}']) {
        fs.writeFileSync(f.record, data); assert.equal(new UpdateStore(f.record).pending, undefined);
    }
});

test("cache validation binds version, format, filename and digest to current feed metadata", async t => {
    const f = fixture(t);
    assert.equal(await verifyPending(f.pending, f.info, "nsis"), true);
    for (const patch of [{ version: "0.9.0" }, { format: "mac" }, { sha512: "untrusted" }, { file: f.dir }]) {
        assert.equal(await verifyPending({ ...f.pending, ...patch }, f.info, "nsis"), false);
    }
    assert.equal(await verifyPending(f.pending, { ...f.info, files: [{ ...f.info.files[0], url: "Other.exe" }] }, "nsis"), false);
});

function loadUpdater(t, format, options = {}) {
    const f = fixture(t); const handlers = new Map(); const logs = [];
    if (format) fs.writeFileSync(path.join(f.dir, "package-type"), format);
    fs.writeFileSync(path.join(f.dir, "app-update.yml"), "provider: github\nowner: fixture\nrepo: Desktop\n");
    const mainFrame = { url: "pixivbiu://core/" }; const win = { webContents: { mainFrame, send() {} } };
    const executable = path.join(f.dir, "custom install", "PixivBiu.exe");
    const app = Object.assign(new EventEmitter(), { isPackaged: options.packaged ?? !!format, getVersion: () => "2.0.0",
        getPath: name => name === "exe" ? executable : f.dir });
    t.after(() => app.emit("before-quit"));
    const electron = { app, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) } };
    const filename = path.resolve(import.meta.dirname, "../desktop/dist/updater.js");
    const localRequire = createRequire(filename); const exports = {};
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
        exports, console, setTimeout, clearTimeout, URL, AbortSignal, Error,
        process: { platform: options.platform ?? "linux", resourcesPath: f.dir, env: {} },
        require: name => name === "electron" ? electron : name === "electron-updater" ? { autoUpdater: f.driver }
            : name === "./core-diagnostics" ? { CoreDiagnostics: class { append(text) { logs.push(text); } async flush() {} } } : localRequire(name),
    }, { filename });
    exports.initUpdater(() => win, async () => {}, () => {});
    return { ...f, handlers, logs, exports, executable, event: { sender: win.webContents, senderFrame: mainFrame }, win };
}

test("packaged Windows updates retain the running executable directory through the public NSIS API", async t => {
    const f = loadUpdater(t, "nsis", { platform: "win32" });
    await f.handlers.get("pixivbiu:update-read")(f.event);
    assert.equal(f.driver.installDirectory, path.dirname(f.executable));
    await f.handlers.get("pixivbiu:update-check")(f.event);
    await f.handlers.get("pixivbiu:update-check")(f.event);
    assert.equal(f.driver.installDirectory, path.dirname(f.executable), "successive offers retain the current installation path");
    assert.throws(() => f.exports.configureWindowsInstallDirectory(f.driver, "relative.exe"), /invalid_install_directory/);
});

test("development and non-Windows updaters do not override their installation directory", async t => {
    for (const options of [{ platform: "win32", packaged: false }, { platform: "darwin", packaged: true }, { platform: "linux", packaged: true }]) {
        const f = loadUpdater(t, undefined, options);
        await f.handlers.get("pixivbiu:update-read")(f.event);
        assert.equal(f.driver.installDirectory, undefined);
    }
});

test("every update IPC checks trusted window and main frame; snapshots use Desktop version", async t => {
    const f = loadUpdater(t);
    for (const [channel, handle] of f.handlers) {
        for (const event of [{ sender: {}, senderFrame: f.event.senderFrame }, { sender: f.win.webContents, senderFrame: { url: "pixivbiu://core/" } }]) {
            await assert.rejects(handle(event), /unauthorized_ipc/, channel);
        }
    }
    const snapshot = await f.handlers.get("pixivbiu:update-read")(f.event);
    assert.equal(snapshot.currentVersion, "2.0.0"); assert.equal(snapshot.installMode, "disabled");
    assert.equal(f.handlers.size, 5);
});

test("package identity wins over APPIMAGE and platform formats stay explicit", async t => {
    const f = loadUpdater(t); const detect = f.exports.detectUpdateFormat;
    assert.equal(await detect("win32", f.dir), "nsis"); assert.equal(await detect("darwin", f.dir), "mac");
    assert.equal(await detect("linux", f.dir, f.file), "appimage");
    for (const identity of ["deb", "rpm"]) {
        fs.writeFileSync(path.join(f.dir, "package-type"), identity);
        assert.equal(await detect("linux", f.dir, f.file), identity);
    }
    fs.unlinkSync(path.join(f.dir, "package-type")); assert.equal(await detect("linux", f.dir, "relative"), "unsupported");
});

for (const format of ["deb", "rpm"]) {
    test(`${format} IPC offers the matching package from the configured repository and rejects install`, async t => {
        const f = loadUpdater(t, format); f.info.version = "2.1.0";
        const name = "PixivBiu-Desktop-2.1.0-linux-" + (format === "deb" ? "amd64.deb" : "x86_64.rpm");
        f.info.files.push({ url: name, sha512: "fixture" });
        await f.handlers.get("pixivbiu:update-check")(f.event);
        const snapshot = await f.handlers.get("pixivbiu:update-read")(f.event);
        assert.equal(snapshot.installMode, "external");
        assert.equal(snapshot.releaseUrl, "https://github.com/fixture/Desktop/releases/tag/v2.1.0");
        assert.equal(snapshot.installerUrl, "https://github.com/fixture/Desktop/releases/download/v2.1.0/" + name);
        for (const channel of ["pixivbiu:update-download", "pixivbiu:update-restart", "pixivbiu:update-install"]) {
            await assert.rejects(f.handlers.get(channel)(f.event), /not_supported/);
        }
    });
}

test("update diagnostics redact URL credentials, queries and bearer tokens and cap each detail", t => {
    const f = loadUpdater(t);
    f.driver.logger.error("failed https://synthetic-user:synthetic-password@updates.invalid/a?token=synthetic-secret#fragment Bearer synthetic-bearer password=synthetic-password " + "x".repeat(5000));
    const log = f.logs.join("");
    for (const secret of ["synthetic-user", "synthetic-password", "synthetic-secret", "synthetic-bearer", "fragment"]) assert.equal(log.includes(secret), false);
    assert.ok(log.includes("[redacted]")); assert.ok(log.includes("https://updates.invalid/a")); assert.ok(log.length < 4200);
});

test("sandboxed update bridge forwards new and legacy channels and removes listeners", async () => {
    const invoked = [], ipc = Object.assign(new EventEmitter(), { invoke: async channel => { invoked.push(channel); return { sequence: 7 }; } });
    let bridge;
    const filename = path.resolve(import.meta.dirname, "../desktop/dist/preload.js");
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), { exports: {}, location: { protocol: "pixivbiu:" },
        process: { platform: "win32", arch: "x64", argv: [] },
        require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } } }),
    }, { filename });
    const received = [], stop = bridge.updates.onStatus(status => received.push(status.sequence));
    await bridge.updates.read(); await bridge.updates.check(); await bridge.updates.download();
    await bridge.updates.restartAndInstall(); await bridge.updates.downloadAndInstall();
    assert.deepEqual(invoked, ["pixivbiu:update-read", "pixivbiu:update-check", "pixivbiu:update-download", "pixivbiu:update-restart", "pixivbiu:update-install"]);
    ipc.emit("pixivbiu:update-status", {}, { sequence: 8 }); stop(); ipc.emit("pixivbiu:update-status", {}, { sequence: 9 });
    assert.deepEqual(received, [8]); assert.equal(ipc.listenerCount("pixivbiu:update-status"), 0);
});
