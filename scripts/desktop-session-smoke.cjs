// Run with desktop's Electron binary. Uses only a synthetic local server and a
// temporary profile; never starts the core or reads real account/keychain data.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { registerCoreScheme, installCoreProtocol } = require("../desktop/dist/core-protocol");
const { PreferenceStore } = require("../desktop/dist/preferences");
const { isTrustedIPCEvent } = require("../desktop/dist/security");
const ts = require("../frontend/node_modules/typescript");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-session-smoke-"));
app.setPath("userData", dir);
app.enableSandbox();
registerCoreScheme();
const sessions = [];
app.on("session-created", ses => sessions.push(ses));
app.on("window-all-closed", () => {});
const timeout = setTimeout(() => { console.error("Native session smoke timed out"); app.exit(1); }, 30000);
let server;
let win;

app.whenReady().then(async () => {
    const ses = session.fromPartition("pixivbiu-main");
    assert.equal(ses.isPersistent(), false);
    const store = new PreferenceStore(path.join(dir, "ui-preferences.json"));
    store.write("PARAGLIDE_LOCALE", "ja");
    const adapter = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../frontend/src/lib/preferences.ts"), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    server = http.createServer((req, res) => {
        if (req.url === "/adapter.js") {
            res.setHeader("Content-Type", "application/javascript");
            res.end(`const exports = {};\n${adapter}\nwindow.preferences = exports;`);
        } else {
            res.setHeader("Content-Type", "text/html");
            res.end('<!doctype html><html><head><script src="/adapter.js"></script></head><body>Session smoke fixture</body></html>');
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    installCoreProtocol(ses, () => server.address().port);
    ipcMain.handle("pixivbiu:preferences-read", event => {
        assert.equal(isTrustedIPCEvent(event, win), true);
        return store.read();
    });
    ipcMain.handle("pixivbiu:preferences-write", (event, key, value) => {
        assert.equal(isTrustedIPCEvent(event, win), true);
        store.write(key, value);
    });
    const open = async () => {
        win = new BrowserWindow({ show: false, webPreferences: {
            session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false,
            preload: path.join(__dirname, "../desktop/dist/preload.js"),
        } });
        await win.loadURL("pixivbiu://core/");
    };
    await open();
    assert.equal(await win.webContents.executeJavaScript(`(async () => {
        await preferences.restoreDesktopPreferences();
        return localStorage.getItem("PARAGLIDE_LOCALE");
    })()`), "ja");
    await win.webContents.executeJavaScript(`preferences.writePreference("PARAGLIDE_LOCALE", "zh-CN")`);
    // An ordered read acts as an IPC barrier after the adapter's async write.
    assert.equal(await win.webContents.executeJavaScript(`window.pixivbiu.preferences.read().then(v => v.PARAGLIDE_LOCALE)`), "zh-CN");
    assert.equal(new PreferenceStore(path.join(dir, "ui-preferences.json")).read().PARAGLIDE_LOCALE, "zh-CN");
    await win.webContents.executeJavaScript(`localStorage.clear()`);
    win.destroy();
    await open();
    assert.equal(await win.webContents.executeJavaScript(`preferences.restoreDesktopPreferences().then(() => localStorage.getItem("PARAGLIDE_LOCALE"))`), "zh-CN");
    assert.equal(sessions.every(s => !s.isPersistent()), true);
    console.log("Native smoke passed: memory-only sessions, protocol proxy, sandboxed preload, preference commit and window recreation");
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    clearTimeout(timeout);
    if (win && !win.isDestroyed()) win.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
