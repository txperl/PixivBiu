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
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
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
const watchdog = setTimeout(() => { console.error('Chrome smoke timed out'); app.exit(1); }, 180000);
const runFile = promisify(execFile);
const artwork = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1, title: `Fixture artwork ${i + 1}`, type: 'illust',
    image_urls: { square_medium: '/fixture-image.svg', medium: '/fixture-image.svg', large: '/fixture-image.svg' },
    user: { id: 1, name: 'Fixture artist', account: 'fixture', profile_image_urls: { medium: '/fixture-image.svg' } },
    width: 400, height: 400, page_count: 1, tags: [], tools: [], meta_pages: [],
    meta_single_page: { original_image_url: '/fixture-image.svg' },
    total_bookmarks: 100, total_view: 1000, is_bookmarked: false, visible: true,
    x_restrict: 0, illust_ai_type: 1, create_date: '2026-01-01T00:00:00Z', caption: '',
}));

async function nativeHits(points) {
    const handle = win.getNativeWindowHandle();
    const value = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
    const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-File',
        path.join(__dirname, 'windows-window-hit-test.ps1'), '-WindowHandle', value,
        '-PointsJson', JSON.stringify(points), '-ZoomFactor', String(win.webContents.getZoomFactor())],
    { windowsHide: true, timeout: 15000 });
    return JSON.parse(stdout);
}

async function checkSidebarDrag(mode, mac, nativeProbe) {
    const draggable = mac || mode === 'win32' || (mode === 'native' && process.platform === 'win32');
    const previousSize = win.getSize();
    // Leave enough room for the real account button beneath all nav groups.
    win.setSize(1100, 850);
    await delay(100);
    const sidebar = await win.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('[data-window-sidebar]');
        const brand = root.firstElementChild.getBoundingClientRect();
        const nav = root.querySelector('nav').getBoundingClientRect();
        const center = el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        return { drag: getComputedStyle(root).getPropertyValue('app-region') === 'drag',
            railDrag: getComputedStyle(document.querySelector('.window-root-layout > aside')).getPropertyValue('app-region') === 'drag',
            points: [{ x: brand.x + brand.width / 2, y: (brand.bottom + nav.top) / 2 },
                center(root.querySelector('a[href="/search"]')), center(root.querySelector('[data-slot="dropdown-menu-trigger"]'))] };
    })()`);
    assert.equal(sidebar.drag, draggable, `${mode}: sidebar drag is platform-gated`);
    assert.equal(sidebar.railDrag, mac, `${mode}: activity rail keeps its platform policy`);
    if (nativeProbe) assert.deepEqual(await nativeHits(sidebar.points), [2, 1, 1], `${mode}: sidebar gap drags, navigation and account receive clicks`);
    await click('[data-window-sidebar] a[href="/search"]');
    await waitFor(`location.pathname === '/search' && !!document.querySelector('input[type="search"]')`);
    await click('[data-window-sidebar] [data-slot="dropdown-menu-trigger"]');
    await waitFor(`!!document.querySelector('[data-slot="dropdown-menu-content"]')`);
    await delay(150);
    if (nativeProbe) {
        const menuPoint = await win.webContents.executeJavaScript(`(() => {
            const r = document.querySelector('[data-slot="dropdown-menu-item"]').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`);
        assert.deepEqual(await nativeHits([menuPoint]), [1], `${mode}: account menu overrides sidebar dragging`);
    }
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(`!document.querySelector('[data-slot="dropdown-menu-content"]')`);
    const fullscreen = await win.webContents.executeJavaScript(`(() => {
        document.documentElement.setAttribute('data-window-fullscreen', '');
        const sidebar = document.querySelector('[data-window-sidebar]');
        return { drag: getComputedStyle(sidebar).getPropertyValue('app-region') === 'drag',
            noDrag: getComputedStyle(sidebar.querySelector('a')).getPropertyValue('app-region') === 'no-drag' };
    })()`);
    assert.deepEqual(fullscreen, { drag: false, noDrag: false }, `${mode}: sidebar regions are disabled in fullscreen`);
    await win.webContents.executeJavaScript(`document.documentElement.removeAttribute('data-window-fullscreen')`);
    await delay(100);
    if (nativeProbe) assert.deepEqual(await nativeHits(sidebar.points), [2, 1, 1], `${mode}: sidebar regions recover after fullscreen CSS state`);
    win.setSize(...previousSize);
    await delay(100);
}

async function checkDragRegions(mode) {
    const mac = mode === 'darwin' || (mode === 'native' && process.platform === 'darwin');
    const nativeProbe = process.platform === 'win32' && (mode === 'native' || mode === 'darwin');
    await checkSidebarDrag(mode, mac, nativeProbe);
    await win.loadURL('pixivbiu://core/ranking');
    await waitFor(`document.querySelector('img[alt="Fixture artwork 1"]')?.naturalWidth > 0`);
    for (const zoom of [1, 1.5]) {
        win.webContents.setZoomFactor(zoom);
        await delay(100);
        // Use the actual page scroller and actual IllustCard, with its nested
        // selection/download/preview buttons, not a hand-written card imitation.
        const points = await win.webContents.executeJavaScript(`(() => {
            const scroller = document.querySelector('[data-app-scroller]');
            const img = document.querySelector('img[alt="Fixture artwork 1"]');
            scroller.scrollTop += img.getBoundingClientRect().top + 70;
            const r = img.getBoundingClientRect();
            return [{ x: r.x + r.width / 2, y: 20 }, { x: r.x + r.width / 2, y: 80 }];
        })()`);
        await delay(100);
        if (nativeProbe) assert.deepEqual(await nativeHits(points), [2, 1], `${mode} zoom ${zoom}: caption over scrolled artwork, client below`);
        // Image loading/fallback must not change window hit regions.
        await win.webContents.executeJavaScript(`document.querySelector('img[alt="Fixture artwork 1"]').style.visibility = 'hidden'`);
        await delay(100);
        if (nativeProbe) assert.deepEqual(await nativeHits(points), [2, 1], `${mode} zoom ${zoom}: fallback has the same hit regions`);
        await win.webContents.executeJavaScript(`document.querySelector('img[alt="Fixture artwork 1"]').style.visibility = ''`);
    }
    win.webContents.setZoomFactor(1);
    await win.loadURL('pixivbiu://core/search');
    await waitFor(`!!document.querySelector('input[type="search"]')`);
    const search = await win.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('input[type="search"]');
        const r = input.getBoundingClientRect();
        return { point: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
            noDrag: getComputedStyle(input).getPropertyValue('app-region') === 'no-drag',
            inset: document.querySelector('[data-window-content]').getBoundingClientRect().top };
    })()`);
    assert.equal(search.noDrag, mac, `${mode}: search exceptions only in macOS chrome`);
    if (mac) assert.equal(search.inset, 0, 'macOS keeps the original zero content inset');
    if (nativeProbe) assert.deepEqual(await nativeHits([search.point]), [1], `${mode}: search is a native client region`);
    await click('input[type="search"]');
    await waitFor(`document.activeElement?.matches('input[type="search"]')`);
    // Exercise the CSS state contract independently of native fullscreen IPC.
    // The full suite below still validates real host transitions separately.
    const fullscreen = await win.webContents.executeJavaScript(`(() => {
        document.documentElement.setAttribute('data-window-fullscreen', '');
        return { strip: document.querySelector('.mac-window-drag-strip').getBoundingClientRect().height,
            inset: document.querySelector('[data-window-content]').getBoundingClientRect().top,
            noDrag: getComputedStyle(document.querySelector('input[type="search"]')).getPropertyValue('app-region') === 'no-drag' };
    })()`);
    assert.deepEqual(fullscreen, { strip: 0, inset: 0, noDrag: false }, `${mode}: fullscreen removes chrome and control exceptions`);
    await win.webContents.executeJavaScript(`document.documentElement.removeAttribute('data-window-fullscreen')`);
    // A tall portal must remain interactive where it overlaps the Mac band.
    await win.loadURL('pixivbiu://core/ranking?illust=1');
    await waitFor(`!!document.querySelector('[data-slot="dialog-content"]')`);
    await delay(150);
    if (nativeProbe) {
        const points = await win.webContents.executeJavaScript(`(() => {
            const r = document.querySelector('[data-slot="dialog-content"]').getBoundingClientRect();
            const sidebar = document.querySelector('[data-window-sidebar]').getBoundingClientRect();
            return [{ x: r.x + r.width / 2, y: r.y + 10 }, { x: sidebar.x + sidebar.width / 2, y: sidebar.y + 70 }];
        })()`);
        assert.deepEqual(await nativeHits(points), [1, 1], `${mode}: dialog and backdrop over sidebar receive pointer input`);
    }
    await win.loadURL('pixivbiu://core/downloads');
    await waitFor(`!!document.querySelector('button[aria-label="Filter"]')`);
    console.log(`Drag regression passed: ${mode}${nativeProbe ? ' (Windows native hit tests)' : ' (renderer checks)'}`);
}

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
        if (pathname === '/fixture-image.svg') {
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#9180bb"/></svg>');
        }
        if (pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            if (pathname === '/api/v1/auth/status') return res.end(JSON.stringify({ authenticated, user_id: 1 }));
            if (pathname === '/api/v1/downloads') return res.end(JSON.stringify({ jobs: [], total: 0, page: 1, per_page: 20 }));
            if (pathname === '/api/v1/illusts/ranking') return res.end(JSON.stringify({ illusts: artwork, next_offset: null }));
            if (pathname === '/api/v1/illusts/1') return res.end(JSON.stringify({ illust: artwork[0] }));
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

    const modes = ['win32', 'darwin', 'linux', 'browser', 'old-shell', ...(process.argv.includes('--layout-only') ? [] : ['native'])];
    for (const mode of modes) {
        const args = mode === 'native' ? chromeArgs() : ['win32', 'darwin'].includes(mode) ? ['--pixivbiu-frameless'] : [];
        if (mode !== 'native') args.push(`--fixture-os=${mode === 'old-shell' ? 'win32' : mode}`);
        win = new BrowserWindow({ width: 960, height: 600, show: false,
            ...(mode === 'native' ? chromeOptions() : mode === 'darwin' ? { frame: false } : {}),
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
        await checkDragRegions(mode);
        if (mode === 'win32' && !process.argv.includes('--drag-only')) {
            // Preserve the existing unavailable-detail layout case separately
            // from the loaded artwork used by the drag regression above.
            await win.loadURL('pixivbiu://core/downloads?illust=999');
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
        if (mode === 'native' && !process.argv.includes('--drag-only')) {
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
    try { fs.rmSync(dir, { recursive: true, force: true }); }
    catch (error) {
        // Chromium can still hold its temporary profile open on Windows until
        // app.exit. Do not strand the test process after a failed assertion.
        console.warn(`Temporary chrome profile still locked at exit: ${error.code}`);
    }
    app.exit(process.exitCode || 0);
});
