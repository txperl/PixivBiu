// Built SPA + synthetic API in isolated Electron windows. No core/account data.
// Native controls are only validated for the host OS; other platforms exercise
// renderer layout with declared platform flags, never claim native coverage.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { registerCoreScheme, installCoreProtocol } = require('../desktop/dist/core-protocol');
const { chromeOptions, chromeArgs, trackWindowChrome } = require('../desktop/dist/window-chrome');
const { isTrustedIPCEvent, startingPage, failurePage } = require('../desktop/dist/security');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixivbiu-chrome-smoke-'));
const assets = path.resolve(__dirname, '../internal/web/dist');
const preload = path.join(dir, 'preload.cjs');
// Reuse the production bridge, changing only its OS declaration for layout cases.
const productionPreload = fs.readFileSync(path.resolve(__dirname, '../desktop/dist/preload.js'), 'utf8');
fs.writeFileSync(preload, productionPreload.replace('os: process.platform,',
    'os: process.argv.find(v => v.startsWith("--fixture-os="))?.split("=")[1] || process.platform,'));
app.setPath('userData', dir);
app.enableSandbox();
registerCoreScheme();
app.on('window-all-closed', () => {});
let win;
let server;
let readChrome;
let authenticated = true;
const watchdog = setTimeout(() => { console.error('Chrome smoke timed out'); app.exit(1); }, 60000);

async function waitFor(expression) {
    const deadline = Date.now() + 8000;
    while (!(await win.webContents.executeJavaScript(expression))) {
        assert.ok(Date.now() < deadline, `Timed out: ${expression}`);
        await delay(30);
    }
}
async function layout() {
    return win.webContents.executeJavaScript(`(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return { content: rect('[data-window-content]'), filter: rect('button[aria-label="Filter"]'),
            dialog: rect('[data-slot="dialog-content"]'), bar: rect('.window-titlebar'),
            height: innerHeight, scrollHeight: document.documentElement.scrollHeight };
    })()`);
}
async function click(selector) {
    const point = await win.webContents.executeJavaScript(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
}

app.whenReady().then(async () => {
    assert.ok(fs.existsSync(path.join(assets, 'index.html')), 'Run the frontend build first');
    const ses = session.fromPartition('pixivbiu-chrome-smoke');
    server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://fixture').pathname;
        if (pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            if (pathname === '/api/v1/auth/status') return res.end(JSON.stringify({ authenticated, user_id: 1 }));
            if (pathname === '/api/v1/downloads') return res.end(JSON.stringify({ jobs: [], total: 0, page: 1, per_page: 20 }));
            res.writeHead(503);
            return res.end(JSON.stringify({ code: 'unavailable', kind: 'app', message: 'Synthetic offline fixture' }));
        }
        const file = pathname.startsWith('/assets/') ? path.join(assets, 'assets', path.basename(pathname)) : path.join(assets, 'index.html');
        const types = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    installCoreProtocol(ses, () => server.address().port);
    ipcMain.handle('pixivbiu:window-chrome-read', event => {
        if (!isTrustedIPCEvent(event, win)) throw new Error('unauthorized_ipc');
        return readChrome();
    });
    ipcMain.handle('pixivbiu:preferences-read', () => ({ PARAGLIDE_LOCALE: 'en' }));
    ipcMain.handle('pixivbiu:preferences-write', () => {});
    ipcMain.handle('pixivbiu:update-check', () => {});

    const modes = ['win32', 'linux', 'browser', 'old-shell', ...(process.argv.includes('--layout-only') ? [] : ['native'])];
    for (const mode of modes) {
        const args = mode === 'native' ? chromeArgs() : mode === 'win32' ? ['--pixivbiu-frameless'] : [];
        if (mode !== 'native') args.push(`--fixture-os=${mode === 'old-shell' ? 'win32' : mode}`);
        win = new BrowserWindow({ width: 960, height: 600, show: false,
            ...(mode === 'native' ? chromeOptions() : {}),
            webPreferences: { session: ses, preload: mode === 'browser' ? undefined : preload,
                sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, additionalArguments: args },
        });
        readChrome = trackWindowChrome(win);
        await win.loadURL('pixivbiu://core/downloads');
        await waitFor(`!!document.querySelector('button[aria-label="Filter"]')`);
        const inset = mode === 'win32' || (mode === 'native' && process.platform === 'win32');
        let result = await layout();
        assert.equal(result.content.y >= 36, inset, mode);
        assert.ok(Math.abs(result.content.bottom - result.height) <= 1, `${mode}: content fills remaining height`);
        assert.ok(result.scrollHeight <= result.height + 1, `${mode}: no body overflow`);
        assert.ok(result.filter.y >= result.content.y + 7, `${mode}: Filter clears caption strip`);
        const wasPressed = await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Filter"]').getAttribute('aria-pressed')`);
        await click('button[aria-label="Filter"]');
        await waitFor(`document.querySelector('button[aria-label="Filter"]').getAttribute('aria-pressed') !== ${JSON.stringify(wasPressed)}`);
        if (mode === 'win32') {
            await win.loadURL('pixivbiu://core/downloads?illust=1');
            await waitFor(`!!document.querySelector('[data-slot="dialog-content"]')`);
            await delay(150);
            result = await layout();
            assert.ok(result.dialog.y >= result.content.y + 15, 'viewer clears chrome');
            assert.ok(result.dialog.bottom <= result.height - 15, 'viewer fits content');
            win.webContents.setZoomFactor(1.5);
            await delay(150);
            result = await layout();
            assert.ok(result.dialog.y >= result.content.y, 'zoomed viewer clears chrome');
            assert.ok(result.dialog.bottom <= result.height, `zoomed viewer fits content: ${JSON.stringify(result)}`);
            win.webContents.setZoomFactor(1);
            win.webContents.send('pixivbiu:window-chrome-state', { fullscreen: true });
            await waitFor(`document.querySelector('[data-window-content]').getBoundingClientRect().y === 0`);
            win.webContents.send('pixivbiu:window-chrome-state', { fullscreen: false });
            await waitFor(`document.querySelector('[data-window-content]').getBoundingClientRect().y >= 36`);
            authenticated = false;
            await win.loadURL('pixivbiu://core/login');
            await waitFor(`!!document.querySelector('[role="progressbar"]')`);
            result = await layout();
            assert.ok(result.scrollHeight <= result.height + 1, 'login stays in content viewport');
            authenticated = true;
        }
        if (mode === 'native') {
            // Real host fullscreen transitions, production tracker and preload.
            win.show();
            app.focus({ steal: true });
            await delay(300);
            console.log(`Native fullscreen: entering (current=${win.isFullScreen()})`);
            const entered = once(win, 'enter-full-screen');
            win.setFullScreen(true);
            await entered;
            console.log('Native fullscreen: entered');
            await waitFor(`document.documentElement.hasAttribute('data-window-fullscreen')`);
            const exited = once(win, 'leave-full-screen');
            win.setFullScreen(false);
            await exited;
            console.log('Native fullscreen: exited');
            await waitFor(`!document.documentElement.hasAttribute('data-window-fullscreen')`);
            win.hide();
            for (const page of [startingPage(), failurePage('Synthetic startup failure')]) {
                await win.loadURL(page);
                assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.window-titlebar')).height !== '0px'`), process.platform !== 'linux');
                assert.equal(await win.webContents.executeJavaScript(`window.pixivbiu.windowChrome.read().then(() => false, () => true)`), true, 'data pages cannot invoke chrome IPC');
            }
        }
        console.log(`Chrome smoke passed: ${mode}${mode === 'native' ? ` (${process.platform})` : ' layout'}`);
        win.destroy();
    }
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    clearTimeout(watchdog);
    if (win && !win.isDestroyed()) win.destroy();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
