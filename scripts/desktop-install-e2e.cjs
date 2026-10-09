// Windows only: three real unsigned NSIS versions, localhost feed, isolated identity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const repo = path.resolve(__dirname, '..');
const desktop = path.join(repo, 'desktop');
const { build, Platform } = require(path.join(desktop, 'node_modules/electron-builder'));
const { UUID } = require(path.join(desktop, 'node_modules/builder-util-runtime'));
const reuse = process.argv[2] === '--reuse';
const rebuild = process.argv[2] === '--rebuild';
const outputRoot = path.join(desktop, 'out/update-e2e');
const root = reuse || rebuild ? path.resolve(process.argv[3]) : path.join(outputRoot, String(Date.now()));
assert.ok(root.startsWith(outputRoot + path.sep), 'Run root must be below desktop/out/update-e2e');
const appDir = path.join(root, 'app');
const install = path.join(root, 'installed custom directory');
const product = 'PixivBiu Isolated Update E2E ' + path.basename(root);
const packageName = 'pixivbiu-isolated-update-e2e-' + path.basename(root);
const executable = path.join(install, product + '.exe');
const eventsFile = path.join(root, 'events.jsonl');
const events = () => fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function bytesHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function registryEvidence(label) {
    const appId = JSON.parse(fs.readFileSync(path.join(root, 'builder.json'))).appId;
    const guid = UUID.v5(appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
    const info = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$fixtureGuid=$env:PIXIVBIU_E2E_GUID; @(foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) { foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) { $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view); $key=$base.OpenSubKey("Software\\"+$fixtureGuid); $location=$null; if($key){$location=$key.GetValue("InstallLocation");$key.Dispose()};$base.Dispose();[PSCustomObject]@{hive=$hive.ToString();view=$view.ToString();guid=$fixtureGuid;InstallLocation=$location} } }) | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PIXIVBIU_E2E_GUID: guid } });
    fs.appendFileSync(path.join(root, 'registry.jsonl'), JSON.stringify({ label, guid, data: info.stdout.trim(), error: info.stderr.trim() }) + '\n');
    assert.equal(info.status, 0, info.stderr);
    return JSON.parse(info.stdout);
}
function executableEvidence(file) {
    if (!fs.existsSync(file)) return { file, exists: false };
    const info = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Item -LiteralPath $env:PIXIVBIU_E2E_EXE).VersionInfo | Select-Object FileVersion,ProductVersion | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PIXIVBIU_E2E_EXE: file } });
    assert.equal(info.status, 0, info.stderr);
    const version = JSON.parse(info.stdout);
    const asar = path.join(path.dirname(file), 'resources/app.asar');
    const metadata = JSON.parse(require(path.join(desktop, 'node_modules/@electron/asar')).extractFile(asar, 'package.json'));
    return { file, exists: true, ...version, packageName: metadata.name, packageVersion: metadata.version, executableSha256: bytesHash(file), asarSha256: bytesHash(asar) };
}
function installedEvidence(expectedVersion) {
    const version = executableEvidence(executable);
    assert.equal(version.ProductVersion, expectedVersion + '.0');
    return version;
}
function assertRecovered(ready) {
    assert.equal(ready.execPath, executable);
    assert.equal(ready.sentinel, 'isolated-persistent-fixture');
    assert.equal(ready.configStatus, 200);
    assert.equal(ready.config.effective.download.max_concurrent, 7);
    assert.equal(ready.auth.authenticated, true);
    assert.equal(ready.auth.user_id, 1);
}
async function until(predicate, label, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out: ' + label); await delay(200); }
}
async function command(action) {
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(root, 'command.tmp'), JSON.stringify({ id, action }));
    fs.renameSync(path.join(root, 'command.tmp'), path.join(root, 'command.json'));
    await until(() => events().some(e => e.id === id), action);
    const result = events().find(e => e.id === id);
    assert.notEqual(result.type, 'failure', JSON.stringify(result));
    return result;
}
async function runProcess(file, args) {
    await new Promise((resolve, reject) => {
        const child = spawn(file, args, { windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { child.kill(); reject(new Error('Installer timeout')); }, 120000);
        child.on('error', reject);
        child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Installer exit ' + code)); });
    });
}
async function main() {
    assert.equal(process.platform, 'win32');
    if (reuse || rebuild) {
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'e2e.json'))).root, root);
        assert.equal(JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'))).productName, product, 'Fixture product identity mismatch');
        assert.ok(!fs.existsSync(executable), 'Uninstall previous run before reusing fixtures');
        if (fs.existsSync(eventsFile)) fs.unlinkSync(eventsFile);
    }
    fs.mkdirSync(appDir, { recursive: true });
    fs.mkdirSync(path.join(root, 'data/usr'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/sentinel.txt'), 'isolated-persistent-fixture');
    fs.writeFileSync(path.join(root, 'data/usr/settings.json'), JSON.stringify({ download: { max_concurrent: 7 } }));
    fs.writeFileSync(path.join(root, 'data/usr/state.json'), JSON.stringify({ refresh_token: 'fixture-refresh', access_token: 'fixture-access', access_token_expires_at: new Date(Date.now() + 86400000).toISOString(), user_id: 1 }));
    fs.cpSync(path.join(desktop, 'dist'), path.join(appDir, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'desktop-install-e2e-app.cjs'), path.join(appDir, 'main.cjs'));
    const dependencies = spawnSync('npm.cmd', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: desktop, shell: true, encoding: 'utf8', windowsHide: true });
    assert.equal(dependencies.status, 0, dependencies.stderr);
    for (const source of dependencies.stdout.trim().split(/\r?\n/).slice(1)) {
        fs.cpSync(source, path.join(appDir, path.relative(desktop, source)), { recursive: true });
    }
    let feedDir;
    const server = http.createServer((req, res) => {
        const name = path.basename(new URL(req.url, 'http://localhost').pathname);
        const file = feedDir && path.join(feedDir, name);
        fs.appendFileSync(path.join(root, 'feed-requests.jsonl'), JSON.stringify({ url: req.url, time: Date.now() }) + '\n');
        if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Length', fs.statSync(file).size);
        fs.createReadStream(file).pipe(res);
    });
    const feedPort = reuse ? Number(new URL(JSON.parse(fs.readFileSync(path.join(root, 'builder.json'))).publish.url).port) : 0;
    await new Promise(resolve => server.listen(feedPort, '127.0.0.1', resolve));
    fs.writeFileSync(path.join(root, 'e2e.json'), JSON.stringify({ root }));
    try {
        for (const version of ['0.0.1', '0.0.2', '0.0.3']) {
            if (reuse) { assert.ok(fs.existsSync(path.join(root, version, `fixture-${version}-setup.exe`))); continue; }
            fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: packageName, productName: product, version, main: 'main.cjs', description: 'Isolated updater E2E', author: 'PixivBiu test', dependencies: { 'electron-updater': '6.8.9' } }));
            const config = { electronDist: path.join(desktop, 'node_modules/electron/dist'), appId: 'moe.tls.pixivbiu.update-e2e.' + path.basename(root), productName: product, directories: { app: appDir, output: path.join(root, version) }, afterPack: null, afterAllArtifactBuild: null, files: ['dist/**/*.js', 'main.cjs', 'package.json'], extraResources: [{ from: path.join(desktop, 'out/update-e2e/pixivbiu.exe'), to: 'pixivbiu.exe' }, { from: path.join(root, 'e2e.json'), to: 'e2e.json' }], publish: { provider: 'generic', url: `http://127.0.0.1:${server.address().port}/` }, win: { signExecutable: false, executableName: product }, nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: false, artifactName: 'fixture-${version}-setup.exe' } };
            fs.writeFileSync(path.join(root, "builder.json"), JSON.stringify(config));
            await build({ projectDir: desktop, targets: Platform.WINDOWS.createTarget("nsis", 1), publish: "never", config: path.join(root, "builder.json"), effectiveOptionComputed: async ([defines]) => {
                const identity = { version, APP_ID: defines.APP_ID, APP_GUID: defines.APP_GUID, APP_32: !!defines.APP_32, APP_64: !!defines.APP_64, APP_ARM64: !!defines.APP_ARM64 };
                fs.appendFileSync(path.join(root, 'compiled-identities.jsonl'), JSON.stringify(identity) + '\n');
                return false;
            } });
        }
        feedDir = path.join(root, '0.0.2');
        await runProcess(path.join(root, '0.0.1/fixture-0.0.1-setup.exe'), ['/S', '/currentuser', '/D=' + install]);
        const hashBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(install, 'resources/app.asar'))).digest('hex');
        spawn(executable, [], { windowsHide: true, stdio: 'ignore' });
        await until(() => events().some(e => e.type === 'ready' && e.version === '0.0.1'), 'initial launch');
        const first = events().find(e => e.type === 'ready');
        registryEvidence('initial-ready');
        assertRecovered(first);
        const versions = { '0.0.1': installedEvidence('0.0.1') };
        assert.equal((await command('check')).snapshot.state, 'available');
        assert.equal((await command('download')).snapshot.state, 'downloaded');
        await command('quit');
        await until(() => !alive(first.pid), 'ordinary quit');
        await delay(2500);
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(install, 'resources/app.asar'))).digest('hex'), hashBefore);
        assert.equal(alive(first.corePid), false);
        spawn(executable, [], { windowsHide: true, stdio: 'ignore' });
        await until(() => events().filter(e => e.type === 'ready').length === 2, 'manual relaunch');
        assert.equal((await command('check')).snapshot.state, 'downloaded');
        await command('install');
        await until(() => events().some(e => e.type === 'ready' && e.version === '0.0.2'), 'real installer auto relaunch', 120000);
        const upgraded = events().find(e => e.type === 'ready' && e.version === '0.0.2');
        registryEvidence('first-upgrade-ready');
        assertRecovered(upgraded);
        versions['0.0.2'] = installedEvidence('0.0.2');
        assert.notEqual(versions['0.0.2'].FileVersion, versions['0.0.1'].FileVersion);
        assert.notEqual(versions['0.0.2'].executableSha256, versions['0.0.1'].executableSha256);
        assert.ok(events().some(e => e.action === 'previous-install-installed'));
        assert.notEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(install, 'resources/app.asar'))).digest('hex'), hashBefore);
        for (const old of events().filter(e => e.type === 'ready' && e.version === '0.0.1')) { assert.equal(alive(old.pid), false); assert.equal(alive(old.corePid), false); }
        feedDir = path.join(root, '0.0.3');
        assert.equal((await command('check')).snapshot.state, 'available');
        assert.equal((await command('download')).snapshot.state, 'downloaded');
        await command('install');
        await until(() => events().some(e => e.type === 'ready' && e.version === '0.0.3'), 'second real installer auto relaunch', 120000);
        const upgradedAgain = events().find(e => e.type === 'ready' && e.version === '0.0.3');
        registryEvidence('second-upgrade-ready');
        fs.writeFileSync(path.join(root, 'second-upgrade-paths.json'), JSON.stringify({ expected: executableEvidence(executable), reopened: executableEvidence(upgradedAgain.execPath) }, null, 2));
        assertRecovered(upgradedAgain);
        versions['0.0.3'] = installedEvidence('0.0.3');
        assert.notEqual(versions['0.0.3'].FileVersion, versions['0.0.2'].FileVersion);
        assert.notEqual(versions['0.0.3'].executableSha256, versions['0.0.2'].executableSha256);
        assert.notEqual(versions['0.0.3'].asarSha256, versions['0.0.2'].asarSha256);
        assert.equal(alive(upgraded.pid), false);
        assert.equal(alive(upgraded.corePid), false);
        assert.equal(events().filter(e => e.action === 'previous-install-installed').length, 2);
        const handoffs = events().filter(e => e.type === 'native-installer-handoff');
        assert.equal(handoffs.length, 2);
        for (const handoff of handoffs) { assert.equal(handoff.silent, true); assert.equal(handoff.forceRun, true); }
        assert.equal(events().filter(e => e.type === 'background-download-core-ready').length, 2);
        await command('quit');
        await until(() => !alive(upgradedAgain.pid), 'upgraded quit');
        assert.equal(alive(upgradedAgain.corePid), false);
        fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ passed: true, host: { platform: os.platform(), version: os.version(), release: os.release(), arch: os.arch() }, scope: 'Real unsigned user-level NSIS install, production UpdateController/UpdateStore/CoreSupervisor; fixture main and command transport, no production SPA/IPC', root, versions, first, upgraded, upgradedAgain }, null, 2));
        console.log('PASS: real NSIS update E2E; evidence ' + root);
    } finally {
        server.close();
        const installations = new Set([install, ...events().filter(e => e.type === 'ready').map(e => path.dirname(e.execPath))]);
        for (const directory of installations) {
            const ownership = path.join(directory, 'resources/e2e.json');
            if (!fs.existsSync(ownership)) continue;
            assert.equal(JSON.parse(fs.readFileSync(ownership)).root, root, 'Cleanup ownership mismatch');
            spawnSync('powershell.exe', ['-NoProfile', '-Command', '$fixtureRoot = [IO.Path]::GetFullPath($env:PIXIVBIU_E2E_ROOT); Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($fixtureRoot + "\\", [StringComparison]::OrdinalIgnoreCase) } | Stop-Process'], { windowsHide: true, env: { ...process.env, PIXIVBIU_E2E_ROOT: directory } });
        }
        // A relaunched app can report ready before its updater installer exits.
        // Wait for this run's setup executables before invoking its uninstallers.
        await until(() => {
            const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', '$fixtureRoot=[IO.Path]::GetFullPath($env:PIXIVBIU_E2E_ROOT); @(Get-Process | Where-Object {$_.Path -and $_.Path.StartsWith($fixtureRoot+"\\",[StringComparison]::OrdinalIgnoreCase) -and $_.Path.EndsWith("-setup.exe",[StringComparison]::OrdinalIgnoreCase)}).Count'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PIXIVBIU_E2E_ROOT: root } });
            return result.status === 0 && Number(result.stdout.trim()) === 0;
        }, 'fixture installer exit', 30000);
        for (const directory of installations) {
            const uninstaller = path.join(directory, 'Uninstall ' + product + '.exe');
            if (fs.existsSync(uninstaller)) {
                await runProcess(uninstaller, ['/S']);
                await until(() => !fs.existsSync(directory), 'fixture uninstall', 30000);
            }
        }
        fs.writeFileSync(path.join(root, 'cleanup.json'), JSON.stringify({ installedDirectoryRemoved: [...installations].every(directory => !fs.existsSync(directory)) }));
        const registry = registryEvidence('after-uninstall');
        assert.ok(registry.every(entry => !entry.InstallLocation), 'Fixture install registry remained');
        const localAppData = path.resolve(process.env.LOCALAPPDATA);
        const installerStore = path.join(localAppData, packageName + '-updater');
        assert.ok(installerStore.startsWith(localAppData + path.sep) && path.basename(installerStore) === packageName + '-updater');
        if (fs.existsSync(installerStore)) {
            const cached = path.join(installerStore, 'installer.exe');
            const hashes = ['0.0.1', '0.0.2', '0.0.3'].map(version => bytesHash(path.join(root, version, `fixture-${version}-setup.exe`)));
            assert.ok(fs.existsSync(cached) && hashes.includes(bytesHash(cached)), 'Unknown NSIS installer-store bytes');
            fs.rmSync(installerStore, { recursive: true, force: true });
        }
        fs.writeFileSync(path.join(root, 'cleanup.json'), JSON.stringify({ installedDirectoryRemoved: [...installations].every(directory => !fs.existsSync(directory)), installerStore, installerStoreRemoved: !fs.existsSync(installerStore) }));
    }
}
main().catch(error => {
    console.error(error);
    console.error('Evidence: ' + root);
    if (fs.existsSync(root)) fs.writeFileSync(path.join(root, 'failure.json'), JSON.stringify({ passed: false, error: error.stack }, null, 2));
    process.exit(1);
});
