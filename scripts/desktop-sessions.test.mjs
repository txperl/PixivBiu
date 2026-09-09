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
