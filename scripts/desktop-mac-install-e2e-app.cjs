// Test-only main entry. The production controller, store and Core supervisor
// run unchanged; the production window/preload are covered by native smoke tests.
const { app, autoUpdater: nativeUpdater } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { UpdateController } = require('./dist/update-controller');
const { UpdateStore } = require('./dist/update-store');
const { CoreSupervisor } = require('./dist/core-supervisor');
const { CoreDiagnostics } = require('./dist/core-diagnostics');
const run = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'e2e.json')));
app.setPath('userData', path.join(run.work, 'profile'));
app.setPath('logs', path.join(run.work, 'logs'));
app.on('window-all-closed', () => {});
app.enableSandbox();
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.disableDifferentialDownload = true;
autoUpdater.logger = null;

function record(type, data = {}) {
    fs.appendFileSync(path.join(run.reports, 'events.jsonl'), JSON.stringify({
        type, version: app.getVersion(), pid: process.pid, time: Date.now(), ...data,
    }) + '\n');
}
nativeUpdater.on('error', error => record('native-error', { error: error.message }));
nativeUpdater.on('update-downloaded', () => record('native-downloaded'));
const handoff = autoUpdater.quitAndInstall.bind(autoUpdater);
autoUpdater.quitAndInstall = (...args) => {
    record('native-handoff');
    return handoff(...args);
};
let core, controller, quitReady = false, commandBusy = false;
async function prepareQuit() {
    if (quitReady) return;
    const pid = core.pid;
    await core.stop();
    if (core.state !== 'stopped') throw new Error('core_stop_failed');
    record('core-stopped', { corePid: pid });
    quitReady = true;
}
app.on('before-quit', event => {
    controller?.beginQuit();
    if (quitReady) return;
    event.preventDefault();
    prepareQuit().then(() => app.quit()).catch(error => record('failure', { error: error.message }));
});

async function inspect() {
    const request = route => fetch(`http://127.0.0.1:${core.port}/api/v1/${route}`).then(async response => {
        if (!response.ok) throw new Error(`fixture_http_${response.status}`);
        return response.json();
    });
    const [health, config, auth] = await Promise.all([request('health'), request('config'), request('auth/status')]);
    // Keep only assertions' inputs: never put state.json or full config in reports.
    return { execPath: process.execPath, corePid: core.pid, healthy: health.status === 'ok',
        concurrency: config.effective.download.max_concurrent, authenticated: auth.authenticated,
        userId: auth.user_id, sentinel: fs.readFileSync(path.join(run.work, 'data/sentinel.txt'), 'utf8') };
}
app.whenReady().then(async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PIXIVBIU_')));
    Object.assign(env, {
        PIXIVBIU_DATA_DIR: path.join(run.work, 'data'), PIXIVBIU_CACHE_DIR: path.join(run.work, 'core-cache'),
        PIXIVBIU_LOG_FILE: path.join(run.work, 'core.log'), PIXIVBIU_SERVER_HOST: '127.0.0.1',
        PIXIVBIU_SERVER_PORT_FALLBACK: 'false', PIXIVBIU_APP_OPEN_BROWSER: 'false',
        PIXIVBIU_APP_UPDATE_ENABLED: 'false', PIXIVBIU_PIXIV_PROXY: 'http://127.0.0.1:1',
    });
    const createCore = () => new CoreSupervisor({ binary: path.join(process.resourcesPath, 'pixivbiu'), env,
        diagnostics: new CoreDiagnostics(path.join(run.work, 'core-startup.log')),
        onState(state) { record('core-state', { state, corePid: core?.pid }); },
    });
    core = createCore();
    await core.start();
    controller = new UpdateController(autoUpdater, {
        currentVersion: app.getVersion(), format: 'mac', packaged: app.isPackaged,
        store: new UpdateStore(path.join(run.work, 'profile/update-state.json')), prepareQuit,
        resume() {
            quitReady = false;
            core = createCore();
            void core.start().then(async () => record('core-resumed', await inspect()))
                .catch(error => record('failure', { error: error.message }));
        },
        send: snapshot => record('snapshot', { snapshot }),
        log: (action, error) => record('update-log', { action, error: error?.message }),
        links: async () => ({}), notes: async () => undefined,
    });
    record('ready', await inspect());
    setInterval(async () => {
        const file = path.join(run.work, 'command.json');
        if (commandBusy || !fs.existsSync(file)) return;
        commandBusy = true;
        let id, action;
        try {
            ({ id, action } = JSON.parse(fs.readFileSync(file)));
            fs.unlinkSync(file);
            if (action === 'check') await controller.check();
            else if (action === 'download') {
                const pid = core.pid;
                await controller.download();
                const status = await inspect();
                if (status.corePid !== pid || !status.healthy) throw new Error('download_interrupted_core');
                record('background-download', status);
            } else if (action === 'install') await controller.restartAndInstall();
            else if (action === 'quit') app.quit();
            else throw new Error('unknown_fixture_command');
            record('command-done', { id, action, snapshot: controller.read() });
        } catch (error) { record('command-error', { id, action, error: error.message }); }
        finally { commandBusy = false; }
    }, 100);
}).catch(error => { record('failure', { error: error.message }); app.exit(1); });
