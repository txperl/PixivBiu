// Native Electron + real Go sidecar, isolated profile and synthetic auth only.
// Build the host core first; pass its absolute path as PIXIVBIU_SMOKE_CORE_BIN.
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { CoreSupervisor } = require('../desktop/dist/core-supervisor');
const { CoreDiagnostics } = require('../desktop/dist/core-diagnostics');
const { registerCoreScheme, installCoreProtocol } = require('../desktop/dist/core-protocol');
const { failurePage, desktopFailureAction } = require('../desktop/dist/security');

const binary = process.env.PIXIVBIU_SMOKE_CORE_BIN;
assert.ok(binary && path.isAbsolute(binary), 'Set PIXIVBIU_SMOKE_CORE_BIN to the freshly built host core');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixivbiu-native-core-'));
app.setPath('userData', dir);
app.enableSandbox();
registerCoreScheme();
app.on('window-all-closed', () => {});
let core;
let win;
const pids = [];
const states = [];
const timeout = setTimeout(() => { console.error('Native core smoke timed out'); app.exit(1); }, 45000);
async function until(predicate) {
    const deadline = Date.now() + 10000;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'core state timeout'); await delay(20); }
}
function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}

app.whenReady().then(async () => {
    fs.mkdirSync(path.join(dir, 'usr'));
    fs.writeFileSync(path.join(dir, 'usr/state.json'), JSON.stringify({
        refresh_token: 'fixture-refresh', access_token: 'fixture-access',
        access_token_expires_at: new Date(Date.now() + 86400000).toISOString(), user_id: 1,
    }), { mode: 0o600 });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PIXIVBIU_')));
    Object.assign(env, {
        PIXIVBIU_DATA_DIR: dir, PIXIVBIU_LOG_FILE: path.join(dir, 'business.log'),
        PIXIVBIU_SERVER_HOST: '127.0.0.1', PIXIVBIU_SERVER_PORT_FALLBACK: 'false',
        PIXIVBIU_APP_OPEN_BROWSER: 'false', PIXIVBIU_APP_UPDATE_ENABLED: 'false',
        PIXIVBIU_PIXIV_PROXY: 'http://127.0.0.1:1',
    });
    core = new CoreSupervisor({ binary, env, diagnostics: new CoreDiagnostics(path.join(dir, 'startup.log')),
        onState(state) { states.push(state); if (state === 'ready') pids.push(core.pid); },
    });
    const ses = session.fromPartition('pixivbiu-core-smoke');
    installCoreProtocol(ses, () => core.port);
    win = new BrowserWindow({ show: false, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await core.start();
    assert.equal(core.state, 'ready');
    await win.loadURL('pixivbiu://core/api/v1/health');
    const request = (route, options = {}) => win.webContents.executeJavaScript(`fetch(${JSON.stringify(route)}, ${JSON.stringify(options)}).then(async r => ({status:r.status, body:await r.json()}))`);
    for (const [index, format] of ['json', 'text'].entries()) {
        const events = await fetch(`http://127.0.0.1:${core.port}/api/v1/events`);
        assert.equal(events.status, 200);
        const reader = events.body.getReader();
        let streamClosed = false;
        const drained = (async () => {
            while (!(await reader.read()).done) { /* Consume through shutdown. */ }
            streamClosed = true;
        })();
        const patch = await request('/api/v1/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 'log.format': format }) });
        assert.equal(patch.status, 200);
        assert.equal((await request('/api/v1/config/restart', { method: 'POST' })).status, 202);
        await until(() => pids.length === index + 2);
        const config = await request('/api/v1/config');
        assert.equal(config.status, 200);
        assert.equal(config.body.pending_restart.length, 0);
        assert.equal(alive(pids[index]), false);
        await until(() => streamClosed);
        await drained;
    }
    assert.equal(new Set(pids).size, 3);
    // Exercise the actual navigation event emitted by a shell failure link.
    const failure = failurePage('Fixture failure');
    await win.loadURL(failure);
    const clicked = new Promise(resolve => win.webContents.once('will-navigate', (event, url) => {
        event.preventDefault();
        resolve(desktopFailureAction(win.webContents.getURL(), failure, url));
    }));
    await win.webContents.executeJavaScript('document.querySelector("a").click()');
    assert.equal(await clicked, 'retry');
    await core.stop();
    assert.equal(core.state, 'stopped');
    for (const pid of pids) assert.equal(alive(pid), false);
    assert.equal(ses.isPersistent(), false);
    console.log('Native core smoke passed: real Go core, settings applied across two managed restarts, stable protocol origin, SSE drain, failure action, shutdown without orphan processes');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    await core?.stop();
    clearTimeout(timeout);
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
