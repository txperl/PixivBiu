// Production SPA/preload with synthetic APIs and an isolated memory session.
// Exercises UI/IPC on the host; never starts Core or an OS installer.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { setTimeout: delay } = require("node:timers/promises");
const { registerCoreScheme, installCoreProtocol } = require("../desktop/dist/core-protocol");
const { isTrustedIPCEvent } = require("../desktop/dist/security");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixivbiu-update-smoke-"));
const assets = path.resolve(__dirname, "../internal/web/dist");
const preload = path.resolve(__dirname, "../desktop/dist/preload.js");
app.setPath("userData", dir);
app.enableSandbox();
registerCoreScheme();
app.on("window-all-closed", () => {});
const watchdog = setTimeout(() => { console.error("Update smoke timed out"); app.exit(1); }, 60000);
let win, server, state, locale = "en", activeCount = 0, taskStatusFails = false, failDownload = false;
let downloads = 0, restarts = 0, stopBarrier, queueReads = 0;
const rendererErrors = [];

function offer(format = "nsis") {
    state = { sequence: (state?.sequence ?? 0) + 1, currentVersion: "1.0.0", format,
        installMode: ["deb", "rpm"].includes(format) ? "external" : "in-app", state: "available",
        version: "1.1.0", notes: "### Update fixture\n\nSynthetic release notes.",
        lastChecked: "2026-10-09T00:00:00Z", readyToInstall: false,
        releaseUrl: "https://example.invalid/releases/v1.1.0", installerUrl: "https://example.invalid/Desktop." + format };
}
function publish(patch) {
    state = { ...state, ...patch, sequence: state.sequence + 1 };
    win.webContents.send("pixivbiu:update-status", state);
}
async function waitFor(expression) {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
        if (await win.webContents.executeJavaScript(expression)) return;
        await delay(25);
    }
    throw new Error("Timed out: " + expression + "\n" + await win.webContents.executeJavaScript("document.body.innerText"));
}
const textSelector = (text, root) => `Array.from(document.querySelectorAll(${JSON.stringify(root + " button")})).find(b => b.textContent.trim() === ${JSON.stringify(text)})`;
async function clickText(text, root = '[data-section-id="about"]') {
    const selector = textSelector(text, root);
    await waitFor(`!!(${selector}) && !(${selector}).disabled`);
    const point = await win.webContents.executeJavaScript(`(() => { const b = ${selector}; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}
async function key(keyCode) {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    if (keyCode === "Enter") win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
}
async function open() {
    if (win) win.destroy();
    win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: {
        session: session.fromPartition("pixivbiu-update-smoke"), preload, sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    } });
    win.webContents.on("console-message", details => { if (details.level === "error") rendererErrors.push(details.message); });
    await win.loadURL("pixivbiu://core/settings");
    await waitFor(`!!document.querySelector('[data-section-id="about"]') && document.documentElement.lang === ${JSON.stringify(locale)}`);
}

app.whenReady().then(async () => {
    assert.ok(fs.existsSync(path.join(assets, "index.html")), "Run the frontend build first");
    const ses = session.fromPartition("pixivbiu-update-smoke");
    server = http.createServer((req, res) => {
        const pathname = new URL(req.url, "http://fixture").pathname;
        if (pathname.startsWith("/api/")) {
            res.setHeader("Content-Type", "application/json");
            const json = value => res.end(JSON.stringify(value));
            if (pathname === "/api/v1/auth/status") return json({ authenticated: true, user_id: 1 });
            if (pathname === "/api/v1/system/version") return json({ version: "3.9.0-core", go_version: "go1.26.1", os: "windows", arch: "amd64" });
            if (pathname === "/api/v1/config/schema") return json({ type: "object", properties: {}, "x-cfg-schema-version": "1" });
            if (pathname === "/api/v1/config") return json({ effective: { app: { language: locale } }, file: {}, sources: {}, pending_restart: [], schema_version: "1" });
            if (pathname === "/api/v1/downloads") {
                queueReads++;
                if (!taskStatusFails) return json({ jobs: [], total: 0, page: 1, per_page: 1, active_count: activeCount });
            }
            res.statusCode = 503;
            return json({ code: "unavailable", kind: "app", message: "Synthetic offline fixture" });
        }
        const file = pathname.startsWith("/assets/") ? path.join(assets, "assets", path.basename(pathname)) : path.join(assets, "index.html");
        const types = { ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".html": "text/html" };
        res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    installCoreProtocol(ses, () => server.address().port);
    const handle = (channel, fn) => ipcMain.handle(channel, event => {
        assert.ok(isTrustedIPCEvent(event, win)); return fn();
    });
    handle("pixivbiu:preferences-read", () => ({ PARAGLIDE_LOCALE: locale }));
    handle("pixivbiu:preferences-write", () => {});
    handle("pixivbiu:window-chrome-read", () => ({ fullscreen: false }));
    handle("pixivbiu:update-read", () => state);
    handle("pixivbiu:update-check", () => publish({ state: "available", error: undefined }));
    handle("pixivbiu:update-download", () => {
        downloads++;
        if (failDownload) { publish({ state: "error", error: "download_failed" }); throw new Error("download_failed"); }
        publish({ state: "downloading", percent: 35, error: undefined });
    });
    handle("pixivbiu:update-restart", async () => {
        restarts++;
        publish({ state: "preparing-install", error: undefined });
        await new Promise(resolve => { stopBarrier = resolve; });
        publish({ state: "error", error: "install_failed", installRecoveryRequired: true, readyToInstall: false }); throw new Error("install_failed");
    });
    handle("pixivbiu:update-install", () => assert.fail("modern UI used legacy combined action"));

    for (const language of ["en", "zh-CN", "zh-TW", "ja"]) {
        locale = language; offer(); activeCount = 3; taskStatusFails = false; failDownload = false;
        const m = JSON.parse(fs.readFileSync(path.join(__dirname, "../frontend/src/i18n/messages", locale + ".json"), "utf8"));
        await open();
        await waitFor(`document.body.innerText.includes("1.0.0") && document.body.innerText.includes("3.9.0-core")`);
        const before = downloads;
        await clickText(m.settings_about_download_update);
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_downloading)})`);
        assert.equal(downloads, before + 1);
        assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('[role="status"].fixed')`), false, "download must not block browsing");
        // Navigate through the real sidebar, then return through browser history.
        await win.webContents.executeJavaScript(`document.querySelector('a[href="/downloads"]').click()`);
        await waitFor(`location.pathname === '/downloads'`);
        win.webContents.navigationHistory.goBack();
        await waitFor(`location.pathname === '/settings' && document.body.innerText.includes(${JSON.stringify(m.settings_about_downloading)})`);
        publish({ state: "downloaded", readyToInstall: true, percent: undefined });
        win.webContents.reload();
        await waitFor(`!!(${textSelector(m.settings_about_restart_update, '[data-section-id="about"]')})`);
        // Release notes use the same ready action as About.
        await clickText(m.settings_about_whats_new);
        await waitFor(`!!(${textSelector(m.settings_about_restart_update, '[data-slot="dialog-content"]')})`);
        await key("Escape"); await waitFor(`!document.querySelector('[data-slot="dialog-content"]')`);
        const readsBefore = queueReads, restartsBefore = restarts;
        await clickText(m.settings_about_restart_update);
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_restart_confirm_title)})`);
        assert.ok(queueReads > readsBefore, "restart refreshes the authoritative queue count");
        assert.equal(restarts, restartsBefore, "task warning waits for consent");
        await key("Escape"); await waitFor(`!document.querySelector('[data-slot="dialog-content"]')`);
        taskStatusFails = true;
        await clickText(m.settings_about_restart_update);
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_restart_unknown)})`);
        // Use real keyboard activation for explicit consent in the modal.
        await delay(200); // wait for the modal's own initial-focus restoration
        win.webContents.focus();
        await win.webContents.executeJavaScript(`(${textSelector(m.settings_about_restart_update, '[data-slot="dialog-content"]')}).focus()`);
        await waitFor(`document.activeElement === (${textSelector(m.settings_about_restart_update, '[data-slot="dialog-content"]')})`);
        await key("Enter");
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_restart_preparing)})`);
        assert.equal(restarts, restartsBefore + 1);
        stopBarrier();
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_update_install_failed)}) && !document.querySelector('[role="status"].fixed')`);
        assert.ok(await win.webContents.executeJavaScript(`!!document.querySelector('a[href="https://example.invalid/releases/v1.1.0"]')`), "installation failure offers official repair");
        await waitFor(`!document.querySelector('[data-slot="dialog-content"]')`);
        await delay(100);
        offer(); await open(); failDownload = true;
        await clickText(m.settings_about_download_update);
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_update_download_failed)})`);
        failDownload = false; await clickText(m.settings_about_download_update);
        await waitFor(`document.body.innerText.includes(${JSON.stringify(m.settings_about_downloading)})`);
        console.log("Update renderer smoke passed: " + locale + " (navigation, reload, confirmation, keyboard, failure/retry)");
    }
    locale = "en";
    for (const format of ["deb", "rpm"]) {
        offer(format); await open();
        await waitFor(`document.body.innerText.includes('Get installer') && document.body.innerText.includes('Upgrade instructions')`);
        assert.equal(await win.webContents.executeJavaScript(`!!(${textSelector("Download update", '[data-section-id="about"]')})`), false);
        assert.equal(await win.webContents.executeJavaScript(`document.querySelector('a[href="https://example.invalid/Desktop.${format}"]').textContent.trim()`), "Get installer");
        await clickText("Upgrade instructions"); await waitFor(`document.body.innerText.includes('package manager')`);
        await key("Escape"); console.log("Update renderer smoke passed: " + format + " capability/instructions");
    }
    assert.equal(rendererErrors.some(message => /Uncaught|Error: use|React error/.test(message)), false, rendererErrors.join("\n"));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    clearTimeout(watchdog);
    if (win && !win.isDestroyed()) win.destroy();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { console.warn("Temporary update profile locked at exit: " + error.code); }
    app.exit(process.exitCode || 0);
});
