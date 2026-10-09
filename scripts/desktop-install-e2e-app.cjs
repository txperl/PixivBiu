// Main entry for the isolated, unsigned NSIS fixture; never shipped in PixivBiu.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { UpdateController } = require('./dist/update-controller');
const { UpdateStore } = require('./dist/update-store');
const { configureWindowsInstallDirectory } = require('./dist/updater');
const { CoreSupervisor } = require('./dist/core-supervisor');
const { CoreDiagnostics } = require('./dist/core-diagnostics');
const run = JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'e2e.json')));
process.env.LOCALAPPDATA = path.join(run.root, 'local-app-data');
app.setPath('userData', path.join(run.root, 'profile'));
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.disableWebInstaller = true;
autoUpdater.disableDifferentialDownload = true;
autoUpdater.logger = null;
configureWindowsInstallDirectory(autoUpdater, process.execPath);
function record(type, data = {}) {
    fs.appendFileSync(path.join(run.root, 'events.jsonl'), JSON.stringify({ type, version: app.getVersion(), pid: process.pid, time: Date.now(), ...data }) + '\n');
}
const nativeQuitAndInstall = autoUpdater.quitAndInstall.bind(autoUpdater);
autoUpdater.quitAndInstall = (silent, forceRun) => {
    record('native-installer-handoff', { silent, forceRun });
    return nativeQuitAndInstall(silent, forceRun);
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
app.whenReady().then(async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PIXIVBIU_')));
    Object.assign(env, { PIXIVBIU_DATA_DIR: path.join(run.root, 'data'), PIXIVBIU_CACHE_DIR: path.join(run.root, 'core-cache'), PIXIVBIU_LOG_FILE: path.join(run.root, 'core.log'), PIXIVBIU_SERVER_HOST: '127.0.0.1', PIXIVBIU_SERVER_PORT_FALLBACK: 'false', PIXIVBIU_APP_OPEN_BROWSER: 'false', PIXIVBIU_APP_UPDATE_ENABLED: 'false', PIXIVBIU_PIXIV_PROXY: 'http://127.0.0.1:1' });
    const createCore = () => new CoreSupervisor({ binary: path.join(process.resourcesPath, 'pixivbiu.exe'), env, diagnostics: new CoreDiagnostics(path.join(run.root, 'core-startup.log')), onState() {} });
    core = createCore();
    await core.start();
    const health = await fetch(`http://127.0.0.1:${core.port}/api/v1/health`).then(r => r.json());
    const configResponse = await fetch(`http://127.0.0.1:${core.port}/api/v1/config`);
    const config = await configResponse.json();
    const auth = await fetch(`http://127.0.0.1:${core.port}/api/v1/auth/status`).then(r => r.json());
    controller = new UpdateController(autoUpdater, { currentVersion: app.getVersion(), format: 'nsis', packaged: app.isPackaged, store: new UpdateStore(path.join(run.root, 'profile/update-state.json')), prepareQuit, resume: () => { quitReady = false; core = createCore(); void core.start(); }, send: snapshot => record('snapshot', { snapshot }), log: (action, error) => record('log', { action, error: error?.message }), links: async () => ({}), notes: async () => undefined });
    record('ready', { execPath: process.execPath, corePid: core.pid, health, configStatus: configResponse.status, config, auth, sentinel: fs.readFileSync(path.join(run.root, 'data/sentinel.txt'), 'utf8') });
    setInterval(async () => {
        const file = path.join(run.root, 'command.json');
        if (commandBusy || !fs.existsSync(file)) return;
        commandBusy = true;
        let id, action;
        try {
            ({ id, action } = JSON.parse(fs.readFileSync(file)));
            fs.unlinkSync(file);
            if (action === 'check') await controller.check();
            else if (action === 'download') {
                const corePid = core.pid;
                await controller.download();
                const health = await fetch(`http://127.0.0.1:${core.port}/api/v1/health`).then(r => r.json());
                if (core.pid !== corePid || health.status !== 'ok') throw new Error('download_interrupted_core');
                record('background-download-core-ready', { corePid, health });
            }
            else if (action === 'install') await controller.restartAndInstall();
            else if (action === 'quit') app.quit();
            record('command-done', { id, action, snapshot: controller.read() });
        } catch (error) { record('failure', { id, action, error: error.message }); }
        finally { commandBusy = false; }
    }, 100);
}).catch(error => { record('failure', { error: error.stack }); app.exit(1); });
