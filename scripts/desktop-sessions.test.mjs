import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PreferenceStore } = require("../desktop/dist/preferences.js");

function loadWithElectron(file, electron, overrides = {}) {
    const filename = path.resolve(import.meta.dirname, "../desktop/dist", file);
    const localRequire = createRequire(filename);
    const exports = {};
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
        exports,
        require: (name) => name === "electron" ? electron : localRequire(name),
        console, setTimeout, clearTimeout, queueMicrotask, URL, Headers, Response, ReadableStream, AbortController,
        ...overrides,
    }, { filename });
    return exports;
}

test("UI preferences survive restart, reject arbitrary keys and retain last commit after failure", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-preferences-"));
    try {
        const file = path.join(dir, "prefs.json");
        const store = new PreferenceStore(file);
        store.write("PARAGLIDE_LOCALE", "ja");
        store.write("pixivbiu.search.history.v1", '["猫"]');
        const snapshot = store.read();
        snapshot.PARAGLIDE_LOCALE = "en";
        assert.equal(new PreferenceStore(file).read().PARAGLIDE_LOCALE, "ja");
        for (const key of ["refresh_token", "../other", "__proto__", null]) {
            assert.throws(() => store.write(key, "value"), /invalid_preference/);
        }
        assert.throws(() => store.write("PARAGLIDE_LOCALE", {}), /invalid_preference/);
        assert.throws(() => store.write("PARAGLIDE_LOCALE", "x".repeat(65537)), /invalid_preference/);
        // Make the destination unreplaceable; both the prior file and memory survive.
        fs.renameSync(file, `${file}.saved`);
        fs.mkdirSync(file);
        assert.throws(() => store.write("PARAGLIDE_LOCALE", "en"), /preference_write_failed/);
        assert.equal(store.read().PARAGLIDE_LOCALE, "ja");
        assert.equal(new PreferenceStore(`${file}.saved`).read().PARAGLIDE_LOCALE, "ja");
        assert.equal(fs.readdirSync(dir).some(name => name.endsWith(".tmp")), false);
        fs.rmdirSync(file);
        fs.writeFileSync(file, "broken json");
        assert.deepEqual(new PreferenceStore(file).read(), {});
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("core protocol uses the supplied session and cancels upstream streams", async () => {
    let handler;
    let signal;
    const electron = { protocol: { handle: () => assert.fail("default protocol used") } };
    const { installCoreProtocol } = loadWithElectron("core-protocol.js", electron);
    const ses = {
        protocol: { handle: (_scheme, fn) => { handler = fn; } },
        fetch: async (url, init) => {
            assert.equal(url, "http://127.0.0.1:4001/api/v1/events");
            signal = init.signal;
            return new Response(new ReadableStream());
        },
    };
    installCoreProtocol(ses, () => 4001);
    const request = new Request("pixivbiu://core/api/v1/events");
    const response = await handler(request);
    assert.equal(signal.aborted, false);
    await response.body.cancel();
    assert.equal(signal.aborted, true);
    assert.equal((await handler(new Request("pixivbiu://evil/"))).status, 404);
});

test("OAuth attempts isolate memory sessions and clean success, dismissal, load failure and timeout", async () => {
    const sessions = [];
    const windows = [];
    let timer;
    class Window extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.webContents = new EventEmitter();
            this.webContents.setWindowOpenHandler = fn => { this.popup = fn; };
            windows.push(this);
        }
        loadURL() { return this.fail ? Promise.reject(new Error("load failed")) : Promise.resolve(); }
        isDestroyed() { return this.destroyed === true; }
        close() { this.destroy(); }
        destroy() { this.destroyed = true; this.emit("closed"); }
    }
    const electron = {
        app: { isPackaged: true }, BrowserWindow: Window,
        session: { fromPartition: (name, options) => {
            assert.equal(name.startsWith("persist:"), false);
            assert.equal(options.cache, false);
            const cleared = [];
            const ses = {
                name, cleared,
                setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
                webRequest: { onBeforeRequest(filter, fn) { ses.capture = filter === null ? null : fn; } },
            };
            for (const op of ["clearStorageData", "clearCache", "clearAuthCache", "closeAllConnections"]) {
                ses[op] = async () => { cleared.push(op); };
            }
            sessions.push(ses);
            return ses;
        } },
    };
    const { captureOAuthCode } = loadWithElectron("oauth-window.js", electron, {
        setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {},
    });
    const login = "https://app-api.pixiv.net/web/v1/login";
    const first = captureOAuthCode(login);
    assert.equal(windows[0].popup().action, "deny");
    sessions[0].capture({ url: "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=test" }, result => assert.equal(result.cancel, true));
    assert.equal(await first, "test");
    const second = captureOAuthCode(login);
    windows[1].close();
    await assert.rejects(second, /oauth_cancelled/);
    const third = captureOAuthCode(login);
    timer();
    await assert.rejects(third, /oauth_timeout/);
    Window.prototype.loadURL = () => Promise.reject(new Error("load failed"));
    await assert.rejects(captureOAuthCode(login), /load failed/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(new Set(sessions.map(s => s.name)).size, 4);
    for (const ses of sessions) {
        assert.equal(ses.capture, null);
        assert.equal(ses.cleared.length, 4);
    }
    assert.equal(windows.every(w => w.isDestroyed()), true);
});

function updaterFixture(prepareQuit, resumeAfterFailedUpdate = () => {}) {
    const handlers = new Map();
    const mainFrame = { url: 'pixivbiu://core/' };
    const win = { webContents: { mainFrame, send() {} } };
    const updater = new EventEmitter();
    updater.checkForUpdates = async () => {};
    updater.downloadUpdate = async () => {};
    updater.quitAndInstall = () => {};
    const filename = path.resolve(import.meta.dirname, '../desktop/dist/updater.js');
    const localRequire = createRequire(filename);
    const electron = { app: { isPackaged: false }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } };
    const { initUpdater } = loadWithElectron('updater.js', electron, {
        require: name => name === 'electron' ? electron : name === 'electron-updater' ? { autoUpdater: updater } : localRequire(name),
    });
    initUpdater(() => win, prepareQuit, resumeAfterFailedUpdate);
    const install = () => handlers.get('pixivbiu:update-install')({ sender: win.webContents, senderFrame: mainFrame });
    return { updater, install };
}

test('updater waits for the core shutdown barrier before installation and coalesces duplicate requests', async () => {
    let release;
    const order = [];
    const barrier = new Promise(resolve => { release = resolve; });
    const { updater, install } = updaterFixture(async () => { order.push('stop'); await barrier; });
    updater.downloadUpdate = async () => { order.push('download'); };
    updater.quitAndInstall = () => { order.push('install'); };
    const first = install();
    const second = install();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['download', 'stop']);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['download', 'stop', 'install']);
});

test('download/shutdown errors prevent installation; installer failure resumes the core', async () => {
    let stopped = 0;
    let installed = 0;
    let resumed = 0;
    const { updater, install } = updaterFixture(async () => { stopped++; }, () => { resumed++; });
    updater.downloadUpdate = async () => { throw new Error('fixture download failed'); };
    updater.quitAndInstall = () => { installed++; };
    await assert.rejects(install(), /download failed/);
    assert.equal(stopped, 0);
    assert.equal(installed, 0);
    assert.equal(updater.listenerCount('update-downloaded'), 1, 'only the status listener remains');
    updater.downloadUpdate = async () => {};
    updater.quitAndInstall = () => updater.emit('error', new Error('fixture installer failed'));
    await install();
    assert.equal(stopped, 1);
    assert.equal(resumed, 1);
    updater.emit('error', new Error('unrelated error'));
    assert.equal(resumed, 1);
    const blocked = updaterFixture(async () => { throw new Error('stop failed'); });
    blocked.updater.quitAndInstall = () => assert.fail('installed before cleanup');
    await assert.rejects(blocked.install(), /stop failed/);
});

test('Windows window close waits for core cleanup and duplicate close requests share one barrier', async () => {
    const windows = [];
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let stops = 0;
    let completedQuits = 0;
    let updateBarrier;
    const app = Object.assign(new EventEmitter(), {
        isPackaged: true, getPath: () => '/fixture', enableSandbox() {}, setAppUserModelId() {},
        requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
        quit() {
            const event = { prevented: false, preventDefault() { this.prevented = true; } };
            app.emit('before-quit', event);
            if (!event.prevented) completedQuits++;
        },
    });
    class Window extends EventEmitter {
        static getAllWindows() { return windows; }
        constructor() {
            super();
            windows.push(this);
            this.webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, getURL: () => this.url || '' });
        }
        loadURL(url) { this.url = url; return Promise.resolve(); }
        show() {}
        maximize() {}
    }
    let notify;
    const core = {
        state: 'ready', port: 4000,
        async start() { notify('ready'); },
        async stop() { stops++; await barrier; this.state = 'stopped'; this.port = null; },
    };
    const ses = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
    const electron = { app, BrowserWindow: Window, dialog: { showErrorBox: () => assert.fail('unexpected quit failure') },
        ipcMain: { handle() {} }, session: { fromPartition: () => ses }, shell: {} };
    const filename = path.resolve(import.meta.dirname, '../desktop/dist/main.js');
    const localRequire = createRequire(filename);
    const modules = {
        './core-process': { createCore(fn) { notify = fn; return core; } },
        './core-protocol': { installCoreProtocol() {}, registerCoreScheme() {} },
        './menu': { installMenu() {} }, './oauth-window': { captureOAuthCode() {} },
        './updater': { initUpdater(_window, prepareQuit) { updateBarrier = prepareQuit; } },
        './window-chrome': { chromeArgs: () => [], chromeOptions: () => ({}), trackWindowChrome: () => () => ({ fullscreen: false }) },
        './preferences': { PreferenceStore: class {} },
        './window-state': { restoreWindowState: () => ({ bounds: {} }), trackWindowState() {} },
    };
    loadWithElectron('main.js', electron, {
        __dirname: path.dirname(filename), process: { platform: 'win32', resourcesPath: '/fixture' },
        require: name => name === 'electron' ? electron : modules[name] || localRequire(name),
    });
    await new Promise(resolve => setImmediate(resolve));
    const close = () => {
        const event = { prevented: false, preventDefault() { this.prevented = true; } };
        windows[0].emit('close', event);
        return event.prevented;
    };
    assert.equal(close(), true);
    assert.equal(close(), true);
    const updaterAlsoQuitting = updateBarrier();
    assert.equal(stops, 1);
    assert.equal(completedQuits, 0);
    release();
    await updaterAlsoQuitting;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(completedQuits, 1);
    assert.equal(close(), false);
});

test('window chrome preserves native Linux frames and Windows caption controls across OS versions', () => {
    for (const [platform, release, frost] of [['linux', '6.8.0', false], ['win32', '10.0.19045', false], ['win32', '10.0.22621', true], ['darwin', '24.0.0', true]]) {
        const { chromeOptions, chromeArgs, shellPageChrome } = loadWithElectron('window-chrome.js', {}, {
            process: { platform }, require: name => name === 'node:os' ? { release: () => release } : require(name),
        });
        const options = chromeOptions();
        assert.equal(chromeArgs().includes('--pixivbiu-frost'), frost);
        assert.equal(chromeArgs().includes('--pixivbiu-frameless'), platform !== 'linux');
        if (platform === 'linux') {
            assert.equal(options.titleBarStyle, undefined);
            assert.equal(options.titleBarOverlay, undefined);
            assert.match(shellPageChrome(), /--chrome-height: 0px/);
        } else if (platform === 'win32') {
            assert.equal(options.titleBarStyle, 'hidden');
            assert.equal(options.titleBarOverlay.height, 36);
            assert.equal(options.backgroundMaterial, frost ? 'mica' : undefined);
            assert.match(shellPageChrome(), /titlebar-area-height/);
        } else {
            assert.equal(options.titleBarStyle, 'hiddenInset');
        }
    }
});

test('chrome state handles nested native/HTML fullscreen and page reloads without collapsing maximize', () => {
    const { trackWindowChrome } = require('../desktop/dist/window-chrome.js');
    let fullscreen = false;
    const sent = [];
    const win = Object.assign(new EventEmitter(), {
        isFullScreen: () => fullscreen,
        webContents: Object.assign(new EventEmitter(), { send: (channel, state) => sent.push([channel, state]) }),
    });
    const read = trackWindowChrome(win);
    assert.deepEqual(read(), { fullscreen: false });
    win.emit('maximize');
    assert.deepEqual(read(), { fullscreen: false });
    fullscreen = true;
    win.emit('enter-full-screen');
    win.webContents.emit('enter-html-full-screen');
    fullscreen = false;
    win.emit('leave-full-screen');
    assert.deepEqual(read(), { fullscreen: true });
    win.webContents.emit('leave-html-full-screen');
    win.webContents.emit('did-finish-load');
    assert.deepEqual(sent.map(([, state]) => state.fullscreen), [true, true, true, false, false]);
    assert.equal(sent.every(([channel]) => channel === 'pixivbiu:window-chrome-state'), true);
});

test('sandboxed chrome bridge forwards only state and removes subscription listeners', async () => {
    const ipc = Object.assign(new EventEmitter(), {
        invoke: async channel => {
            assert.equal(channel, 'pixivbiu:window-chrome-read');
            return { fullscreen: false };
        },
    });
    let bridge;
    const attributes = new Map();
    const location = { protocol: 'pixivbiu:' };
    loadWithElectron('preload.js', {
        ipcRenderer: ipc,
        contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
    }, {
        process: { platform: 'win32', arch: 'x64', argv: ['--pixivbiu-frameless'] },
        location, document: { documentElement: { toggleAttribute: (name, value) => attributes.set(name, value) } },
    });
    assert.equal((await bridge.windowChrome.read()).fullscreen, false);
    const received = [];
    const unsubscribe = bridge.windowChrome.onState(state => received.push(state.fullscreen));
    ipc.emit('pixivbiu:window-chrome-state', {}, { fullscreen: true });
    assert.deepEqual(received, [true]);
    assert.equal(attributes.size, 0, 'core documents own their frontend state');
    unsubscribe();
    location.protocol = 'data:';
    ipc.emit('pixivbiu:window-chrome-state', {}, { fullscreen: false });
    assert.deepEqual(received, [true]);
    assert.equal(attributes.get('data-window-fullscreen'), false, 'authored data documents follow notifications');
});
