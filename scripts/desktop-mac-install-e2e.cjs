// Host-native macOS installer regression. No release credentials or publishing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const repo = path.resolve(__dirname, '..');
const desktop = path.join(repo, 'desktop');
const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const root = path.join(desktop, 'out/update-e2e-mac', id);
const work = path.join(root, 'work');
const reports = path.join(root, 'reports');
const appDir = path.join(work, 'app');
const product = `PixivBiu Mac E2E ${id}`;
const packageName = `pixivbiu-mac-e2e-${id}`;
const appId = `moe.tls.pixivbiu.mac-e2e.${id}`;
const installed = path.join(work, 'installed custom directory', `${product}.app`);
const executable = path.join(installed, 'Contents/MacOS', product);
const signing = path.join(work, 'signing');
const keychain = path.join(signing, 'fixture.keychain-db');
const password = randomUUID(); // Disposable fixture only; never logged or retained.
const abort = new AbortController();
const eventsFile = path.join(reports, 'events.jsonl');
const caches = [packageName + '-updater', appId + '.ShipIt'].map(name => path.join(os.homedir(), 'Library/Caches', name));
const result = { passed: false, scope: 'Fixture main with production controller/store/Core supervisor; self-signed local packages, no notarization', host: { platform: process.platform, arch: process.arch, release: os.release() }, checks: [], versions: {} };
let server, feedDir, cleanupMode = false, cacheOwnership = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => abort.abort(new Error(`Interrupted by ${signal}`)));
const watchdog = setTimeout(() => abort.abort(new Error('E2E exceeded 25 minutes')), 25 * 60 * 1000);
watchdog.unref();

const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const events = () => fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
async function hash(file, algorithm = 'sha256', encoding = 'hex') {
    const digest = createHash(algorithm);
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    return digest.digest(encoding);
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function checkpoint() { if (!cleanupMode) abort.signal.throwIfAborted(); }
function passed(check) { result.checks.push(check); console.log(`PASS: ${check}`); }

// Separate process groups let cancellation stop build/signing descendants too.
async function run(label, file, args, options = {}) {
    checkpoint();
    let output = '', errorOutput = '', outputTail = '', failure;
    const env = { ...process.env, ...options.env };
    for (const key of Object.keys(env)) if (/^(CSC_|WIN_CSC_|APPLE_)/.test(key)) delete env[key];
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    const child = spawn(file, args, { cwd: options.cwd || repo, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env });
    const log = data => { if (!options.quiet) fs.appendFileSync(path.join(reports, 'commands.log'), data); };
    child.stdout.on('data', data => { log(data); outputTail = (outputTail + data).slice(-2000); if (options.capture) output += data; });
    child.stderr.on('data', data => { log(data); errorOutput = (errorOutput + data).slice(-2000); });
    let killTimer;
    const stop = reason => {
        if (failure) return;
        failure = reason;
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
    };
    const cancel = () => stop(abort.signal.reason);
    const timeout = setTimeout(() => stop(new Error(`${label} timed out`)), options.timeout || 120000);
    if (!cleanupMode) abort.signal.addEventListener('abort', cancel, { once: true });
    try {
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
        if (failure) throw failure;
        if (code !== 0) throw new Error(`${label} exited ${code}: ${errorOutput || outputTail}`);
        return output.trim();
    } finally {
        clearTimeout(timeout); clearTimeout(killTimer); abort.signal.removeEventListener('abort', cancel);
    }
}
async function until(predicate, label, timeout = 60000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        checkpoint();
        const failure = !cleanupMode && events().find(event => event.type === 'failure');
        if (failure) throw new Error(`Fixture failed: ${failure.error}`);
        assert.ok(Date.now() < deadline, `Timed out: ${label}`);
        await delay(100);
    }
}
async function command(action, expectedError) {
    const commandId = randomUUID();
    json(path.join(work, 'command.tmp'), { id: commandId, action });
    fs.renameSync(path.join(work, 'command.tmp'), path.join(work, 'command.json'));
    await until(() => events().some(event => event.id === commandId), action);
    const event = events().find(event => event.id === commandId);
    if (expectedError) assert.equal(event.error, expectedError);
    else assert.equal(event.type, 'command-done', JSON.stringify(event));
    return event;
}
function recovered(event) {
    assert.equal(event.execPath, executable);
    assert.equal(event.healthy, true);
    assert.equal(event.concurrency, 7);
    assert.equal(event.authenticated, true);
    assert.equal(event.userId, 1);
    assert.equal(event.sentinel, 'isolated-persistent-fixture');
}
async function evidence(version) {
    const plist = path.join(installed, 'Contents/Info.plist');
    assert.equal(await run('Read bundle version', '/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist], { capture: true }), version);
    return { version, executableSha256: await hash(executable), asarSha256: await hash(path.join(installed, 'Contents/Resources/app.asar')) };
}
async function launch() {
    const count = events().filter(event => event.type === 'ready').length;
    const fd = fs.openSync(path.join(reports, 'application.log'), 'a', 0o600);
    const child = spawn(executable, [], { stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    let launchError;
    child.on('error', error => { launchError = error; });
    await until(() => launchError || events().filter(event => event.type === 'ready').length > count, 'application launch');
    if (launchError) throw launchError;
    const ready = events().filter(event => event.type === 'ready').at(-1);
    recovered(ready);
    return ready;
}
async function quit() {
    const ready = events().filter(event => event.type === 'ready' || event.type === 'core-resumed').at(-1);
    await command('quit');
    await until(() => !alive(ready.pid) && !alive(ready.corePid), 'ordinary application/Core exit');
}
async function archive(bundle, directory, version) {
    fs.mkdirSync(directory, { recursive: true });
    const name = `fixture-${version}-${process.arch}.zip`;
    const zip = path.join(directory, name);
    fs.rmSync(zip, { force: true });
    await run('Archive fixture', '/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip]);
    const sha512 = await hash(zip, 'sha512', 'base64');
    json(path.join(directory, 'latest-mac.yml'), { version, files: [{ url: name, sha512, size: fs.statSync(zip).size }], path: name, sha512, releaseDate: new Date().toISOString() });
}

async function prepare() {
    assert.ok(['arm64', 'x64'].includes(process.arch), 'Unsupported host architecture');
    for (const dependency of ['desktop/node_modules/electron', 'frontend/node_modules/typescript']) {
        assert.ok(fs.existsSync(path.join(repo, dependency)), 'Install locked desktop and frontend dependencies first');
    }
    assert.ok(caches.every(cache => !fs.existsSync(cache)), 'Fixture cache identity already exists');
    cacheOwnership = true;
    result.commit = await run('Read commit', 'git', ['rev-parse', 'HEAD'], { capture: true });
    result.dirty = !!await run('Read working tree', 'git', ['status', '--porcelain'], { capture: true });
    result.tools = { node: process.version, go: await run('Check Go', 'go', ['version'], { capture: true }),
        bun: await run('Check Bun', 'bun', ['--version'], { capture: true }),
        electron: require(path.join(desktop, 'node_modules/electron/package.json')).version,
        updater: require(path.join(desktop, 'node_modules/electron-updater/package.json')).version };
    await run('Check OpenSSL', 'openssl', ['version']);
    console.log('Building SPA, desktop and host Core');
    await run('Build SPA', 'bun', ['run', 'build'], { cwd: path.join(repo, 'frontend'), timeout: 300000 });
    await run('Build desktop', 'npm', ['run', 'build'], { cwd: desktop });
    await run('Build Core', 'go', ['build', '-o', path.join(work, 'pixivbiu'), './cmd/server'], { timeout: 300000,
        env: { GOOS: 'darwin', GOARCH: process.arch === 'arm64' ? 'arm64' : 'amd64' } });
    fs.mkdirSync(signing, { mode: 0o700 });
    // A config file works with both macOS LibreSSL and Homebrew OpenSSL.
    fs.writeFileSync(path.join(signing, 'openssl.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=PixivBiu Disposable E2E ' + id + '\n[extensions]\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n');
    await run('Create disposable certificate', 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', path.join(signing, 'openssl.cnf'), '-keyout', path.join(signing, 'key.pem'), '-out', path.join(signing, 'cert.pem')], { quiet: true });
    const opensslVersion = await run('Read OpenSSL version', 'openssl', ['version'], { capture: true });
    await run('Export disposable identity', 'openssl', ['pkcs12', '-export', ...(/^OpenSSL 3\./.test(opensslVersion) ? ['-legacy'] : []), '-inkey', path.join(signing, 'key.pem'), '-in', path.join(signing, 'cert.pem'), '-out', path.join(signing, 'fixture.p12'), '-passout', `pass:${password}`], { quiet: true });
    await run('Create temporary keychain', 'security', ['create-keychain', '-p', password, keychain], { quiet: true });
    await run('Unlock temporary keychain', 'security', ['unlock-keychain', '-p', password, keychain], { quiet: true });
    await run('Import disposable identity', 'security', ['import', path.join(signing, 'fixture.p12'), '-k', keychain, '-P', password, '-T', '/usr/bin/codesign'], { quiet: true });
    await run('Allow fixture signing', 'security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain], { quiet: true });
    const certificate = (await run('Read fixture fingerprint', 'openssl', ['x509', '-in', path.join(signing, 'cert.pem'), '-noout', '-fingerprint', '-sha1'], { capture: true })).split('=')[1].replaceAll(':', '');
    fs.mkdirSync(appDir);
    fs.cpSync(path.join(desktop, 'dist'), path.join(appDir, 'dist'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'desktop-mac-install-e2e-app.cjs'), path.join(appDir, 'main.cjs'));
    const dependencies = await run('Collect production dependencies', 'npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: desktop, capture: true });
    for (const source of dependencies.split(/\r?\n/).slice(1)) {
        const relative = path.relative(desktop, source);
        assert.ok(relative.startsWith('node_modules' + path.sep), 'Dependency escaped desktop/node_modules');
        fs.cpSync(source, path.join(appDir, relative), { recursive: true });
    }
    server = http.createServer((request, response) => {
        const name = path.basename(new URL(request.url, 'http://localhost').pathname);
        const file = feedDir && path.join(feedDir, name);
        fs.appendFileSync(path.join(reports, 'feed-requests.jsonl'), JSON.stringify({ name, time: Date.now() }) + '\n');
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
        response.setHeader('Content-Length', fs.statSync(file).size);
        const stream = fs.createReadStream(file);
        stream.on('error', () => response.destroy());
        response.on('close', () => stream.destroy());
        stream.pipe(response);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    json(path.join(work, 'e2e.json'), { work, reports });
    const builder = path.join(desktop, 'node_modules/electron-builder/cli.js');
    const updaterVersion = result.tools.updater;
    for (const version of ['0.0.1', '0.0.2', '0.0.3']) {
        checkpoint();
        json(path.join(appDir, 'package.json'), { name: packageName, productName: product, version, main: 'main.cjs', description: 'Isolated macOS updater E2E', author: 'PixivBiu tests', dependencies: { 'electron-updater': updaterVersion } });
        const output = path.join(work, version);
        json(path.join(work, 'builder.json'), { electronDist: path.join(desktop, 'node_modules/electron/dist'), appId, productName: product,
            directories: { app: appDir, output }, afterPack: null, afterAllArtifactBuild: null,
            files: ['dist/**/*.js', 'main.cjs', 'package.json'],
            extraResources: [{ from: path.join(work, 'pixivbiu'), to: 'pixivbiu' }, { from: path.join(work, 'e2e.json'), to: 'e2e.json' }],
            publish: { provider: 'generic', url: `http://127.0.0.1:${server.address().port}/` },
            mac: { identity: '-', notarize: false, hardenedRuntime: false, artifactName: 'fixture-${version}-${arch}.${ext}' },
        });
        await run(`Package ${version}`, process.execPath, [builder, '--mac', 'zip', `--${process.arch}`, '--publish', 'never', '--config', path.join(work, 'builder.json')], { cwd: desktop, timeout: 300000 });
        const bundle = path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', product + '.app');
        // A ZIP target makes electron-builder emit app-update.yml normally.
        // Retain its ad-hoc archive for the negative signature test before signing.
        if (version === '0.0.2') {
            const rejected = path.join(work, 'rejected');
            fs.mkdirSync(rejected);
            for (const name of [`fixture-${version}-${process.arch}.zip`, 'latest-mac.yml']) {
                fs.copyFileSync(path.join(output, name), path.join(rejected, name));
            }
        }
        await run(`Sign ${version}`, '/usr/bin/codesign', ['--force', '--sign', certificate, '--keychain', keychain, '--timestamp=none', bundle]);
        await run(`Verify ${version}`, '/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
        await archive(bundle, output, version);
        console.log(`Prepared ${version} (${process.arch})`);
    }
    fs.mkdirSync(path.join(work, 'data/usr'), { recursive: true });
    fs.writeFileSync(path.join(work, 'data/sentinel.txt'), 'isolated-persistent-fixture');
    json(path.join(work, 'data/usr/settings.json'), { download: { max_concurrent: 7 } });
    json(path.join(work, 'data/usr/state.json'), { refresh_token: 'fixture-refresh', access_token: 'fixture-access', access_token_expires_at: new Date(Date.now() + 86400000).toISOString(), user_id: 1 });
    fs.mkdirSync(path.dirname(installed));
    await run('Install initial fixture', '/usr/bin/ditto', [path.join(work, '0.0.1', process.arch === 'arm64' ? 'mac-arm64' : 'mac', product + '.app'), installed]);
}

async function scenarios() {
    feedDir = path.join(work, 'rejected');
    const initial = await launch();
    result.versions['0.0.1'] = await evidence('0.0.1');
    assert.equal((await command('check')).snapshot.state, 'available');
    assert.equal((await command('download')).snapshot.state, 'downloaded');
    await command('install');
    await until(() => events().some(event => event.type === 'native-error') && events().some(event => event.type === 'core-resumed'), 'native signature rejection and Core recovery');
    assert.match(events().find(event => event.type === 'native-error').error, /code signature|code requirement/i);
    const resumed = events().find(event => event.type === 'core-resumed');
    recovered(resumed);
    assert.notEqual(resumed.corePid, initial.corePid);
    assert.equal(alive(initial.corePid), false);
    const snapshot = events().filter(event => event.type === 'snapshot').at(-1).snapshot;
    assert.equal(snapshot.error, 'install_failed');
    assert.equal(snapshot.installRecoveryRequired, true);
    assert.equal(snapshot.readyToInstall, false);
    await command('install', 'install_failed');
    assert.deepEqual(await evidence('0.0.1'), result.versions['0.0.1']);
    await quit();
    passed('Native signature rejection restores Core, preserves installed bytes and blocks another install');

    feedDir = path.join(work, '0.0.2');
    const first = await launch();
    assert.equal((await command('check')).snapshot.state, 'available', 'Changed feed digest invalidates the rejected cached ZIP');
    assert.equal((await command('download')).snapshot.state, 'downloaded');
    await quit();
    assert.equal(alive(first.corePid), false);
    assert.deepEqual(await evidence('0.0.1'), result.versions['0.0.1']);
    assert.equal(events().some(event => event.type === 'native-downloaded'), false);
    passed('Background download keeps Core healthy; ordinary quit does not stage or install');
    const requestsBefore = fs.readFileSync(path.join(reports, 'feed-requests.jsonl'), 'utf8').split('\n').length;
    await launch();
    assert.equal((await command('check')).snapshot.state, 'downloaded');
    assert.ok(fs.readFileSync(path.join(reports, 'feed-requests.jsonl'), 'utf8').split('\n').length > requestsBefore);
    passed('Reopen restores cached readiness only after a fresh feed check and hash verification');
    for (const version of ['0.0.2', '0.0.3']) {
        if (version === '0.0.3') {
            feedDir = path.join(work, version);
            assert.equal((await command('check')).snapshot.state, 'available');
            assert.equal((await command('download')).snapshot.state, 'downloaded');
        }
        const old = events().filter(event => event.type === 'ready').at(-1);
        const errorCount = events().filter(event => event.type === 'native-error').length;
        await command('install');
        await until(() => events().some(event => event.type === 'ready' && event.version === version) || events().filter(event => event.type === 'native-error').length > errorCount, `native upgrade to ${version}`, 90000);
        assert.equal(events().filter(event => event.type === 'native-error').length, errorCount);
        recovered(events().find(event => event.type === 'ready' && event.version === version));
        assert.equal(alive(old.pid), false); assert.equal(alive(old.corePid), false);
        result.versions[version] = await evidence(version);
        const previous = result.versions[version === '0.0.2' ? '0.0.1' : '0.0.2'];
        assert.notEqual(result.versions[version].executableSha256, previous.executableSha256);
        assert.notEqual(result.versions[version].asarSha256, previous.asarSha256);
        passed(`Native upgrade to ${version} replaces bytes, reopens in place and preserves settings/session`);
    }
    assert.equal(events().filter(event => event.action === 'previous-install-installed').length, 2);
    for (const handoff of events().filter(event => event.type === 'native-handoff')) {
        assert.ok(events().some(event => event.type === 'core-stopped' && event.pid === handoff.pid && event.time <= handoff.time));
    }
    assert.equal(events().filter(event => event.type === 'background-download').length, 3);
    await quit();
    passed('Both successful receipts match target versions; Core stops before every native handoff');
}

function ownedProcesses() {
    const listing = spawnSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', timeout: 5000 });
    assert.equal(listing.status, 0, 'Cannot verify fixture process ownership');
    return listing.stdout.split('\n').flatMap(line => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        return match && match[2].startsWith(work + path.sep) ? [Number(match[1])] : [];
    });
}
async function cleanup() {
    cleanupMode = true;
    const errors = [];
    const attempt = async operation => { try { await operation(); } catch (error) { errors.push(error.message); } };
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await attempt(async () => {
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'owner.json'))).id, id);
        for (const pid of ownedProcesses()) { try { process.kill(pid, 'SIGTERM'); } catch {} }
        const end = Date.now() + 5000;
        while (ownedProcesses().length && Date.now() < end) await delay(100);
        for (const pid of ownedProcesses()) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        await until(() => ownedProcesses().length === 0, 'fixture process cleanup', 10000);
    });
    // Always remove the disposable identity, even if process cleanup failed.
    await attempt(async () => { if (fs.existsSync(keychain)) await run('Delete temporary keychain', 'security', ['delete-keychain', keychain], { quiet: true }); });
    await attempt(async () => { fs.rmSync(signing, { recursive: true, force: true }); });
    if (!errors.length) await attempt(async () => {
        if (cacheOwnership) for (const cache of caches) fs.rmSync(cache, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    });
    json(path.join(reports, 'cleanup.json'), { passed: errors.length === 0, errors, workRemoved: !fs.existsSync(work), keychainRemoved: !fs.existsSync(keychain), cachesRemoved: caches.every(cache => !fs.existsSync(cache)) });
    if (errors.length) throw new Error(`Cleanup incomplete: ${errors.join('; ')}`);
}

async function main() {
    assert.equal(process.platform, 'darwin', 'Run this test on macOS');
    assert.equal(process.argv.length, 2, 'This test takes no arguments');
    process.umask(0o077);
    fs.mkdirSync(work, { recursive: true }); fs.mkdirSync(reports);
    json(path.join(root, 'owner.json'), { id });
    console.log(`macOS installer E2E reports: ${reports}`);
    try { await prepare(); await scenarios(); result.passed = true; }
    catch (error) { result.error = error.stack; console.error(error.message); }
    finally {
        clearTimeout(watchdog);
        try { await cleanup(); } catch (error) { result.passed = false; result.cleanupError = error.message; console.error(error.message); }
        json(path.join(reports, 'result.json'), result);
        process.exitCode = result.passed ? 0 : 1;
        console.log(`${result.passed ? 'PASS' : 'FAIL'}: macOS installer E2E; reports: ${reports}`);
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
