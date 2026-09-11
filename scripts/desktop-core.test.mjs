import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { CoreSupervisor } = require('../desktop/dist/core-supervisor.js');
const { CoreDiagnostics } = require('../desktop/dist/core-diagnostics.js');

async function until(predicate, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, 'timed out waiting for core state');
        await delay(20);
    }
}
function alive(pid) {
    try { process.kill(pid, 0); return true; } catch (error) {
        if (error.code === 'ESRCH') return false;
        throw error;
    }
}
function fixture(t, mode = 'normal', overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixivbiu-core-'));
    const pids = path.join(dir, 'pids');
    const file = path.join(dir, 'startup.log');
    const diagnostics = new CoreDiagnostics(file);
    const states = [];
    const core = new CoreSupervisor({
        binary: process.execPath, args: [path.join(import.meta.dirname, 'fixtures/desktop-core.cjs')],
        env: { ...process.env, CORE_FIXTURE_MODE: mode, CORE_FIXTURE_PIDS: pids },
        diagnostics, onState: (state, failure) => states.push({ state, failure }),
        startupTimeout: 3000, stopTimeout: 300, killTimeout: 1000, ...overrides,
    });
    const launched = () => fs.existsSync(pids) ? fs.readFileSync(pids, 'utf8').trim().split('\n').map(Number) : [];
    t.after(async () => {
        await core.stop();
        for (const pid of launched()) assert.equal(alive(pid), false, `left child ${pid} alive`);
        fs.rmSync(dir, { recursive: true, force: true });
    });
    return { core, states, file, diagnostics, launched };
}
async function request(core, route) {
    const response = await fetch(`http://127.0.0.1:${core.port}${route}`);
    return response.json();
}

test('single-flight startup, repeated managed restarts and quit track the current child', async t => {
    const { core, states, launched } = fixture(t);
    await Promise.all([core.start(), core.start(), core.start()]);
    assert.equal(core.state, 'ready');
    assert.equal(launched().length, 1);
    for (let generation = 2; generation <= 3; generation++) {
        const old = await request(core, '/restart');
        await until(() => states.filter(s => s.state === 'ready').length === generation);
        assert.notEqual((await request(core, '/')).pid, old.pid);
        assert.equal(alive(old.pid), false);
    }
    await Promise.all([core.stop(), core.stop()]);
    assert.equal(core.state, 'stopped');
    assert.equal(core.port, null);
    await core.start();
    assert.equal(launched().length, 3, 'quit must prevent respawn');
});

test('unexpected runtime exit stays failed until explicit retry', async t => {
    const { core, launched } = fixture(t);
    await core.start();
    await request(core, '/crash');
    await until(() => core.state === 'failed');
    assert.equal(core.failure, 'core_exited');
    assert.equal(core.port, null);
    await delay(150);
    assert.equal(launched().length, 1);
    await core.start();
    assert.equal(core.state, 'ready');
    assert.equal(launched().length, 2);
});

test('quit during readiness cancels startup and waits for child cleanup', async t => {
    const { core, launched, states } = fixture(t, 'hang');
    const start = core.start();
    await until(() => launched().length > 0);
    await core.stop();
    await start;
    assert.equal(core.state, 'stopped');
    assert.equal(states.some(s => s.state === 'ready'), false);
});

test('readiness timeout force-stops an uncooperative child before reporting failure', async t => {
    const { core, launched } = fixture(t, 'stubborn', { startupTimeout: 500 });
    await core.start();
    assert.equal(core.failure, 'startup_timeout');
    assert.equal(launched().length, 1);
    assert.equal(alive(launched()[0]), false);
});

test('only port conflicts retry; retries are bounded', async t => {
    for (const [mode, count, state] of [['busy-once', 2, 'ready'], ['busy', 3, 'failed'], ['fail', 1, 'failed'], ['legacy', 1, 'failed']]) {
        const { core, launched } = fixture(t, mode);
        await core.start();
        assert.equal(core.state, state, mode);
        assert.equal(launched().length, count, mode);
        if (mode === 'legacy') assert.equal(core.failure, 'incompatible_core');
    }
});

test('missing executable is an asynchronous startup failure, not an unhandled error', async t => {
    const { core } = fixture(t, 'normal', { binary: path.join(os.tmpdir(), `missing-core-${process.pid}`) });
    await core.start();
    assert.equal(core.state, 'failed');
    assert.equal(core.failure, 'start_failed');
});

test('diagnostic pipes remain drained with bounded output and atomic snapshots', async t => {
    const { core, file, diagnostics } = fixture(t, 'noisy');
    await core.start();
    assert.equal(core.state, 'ready');
    await until(() => fs.existsSync(file));
    assert.ok(fs.statSync(file).size <= 65536);
    await core.stop();
    diagnostics.append('final diagnostic\n');
    await diagnostics.flush();
    assert.match(fs.readFileSync(file, 'utf8'), /final diagnostic/);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('loss of the parent closes its lease and terminates the sidecar', async t => {
    const { spawn } = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixivbiu-parent-death-'));
    const ready = path.join(dir, 'ready');
    const parent = spawn(process.execPath, [path.join(import.meta.dirname, 'fixtures/desktop-parent.cjs')], {
        windowsHide: true, stdio: 'ignore', env: { ...process.env,
            CORE_FIXTURE_MODE: 'normal', CORE_FIXTURE_PIDS: path.join(dir, 'pids'),
            CORE_FIXTURE_LOG: path.join(dir, 'log'), CORE_FIXTURE_READY: ready,
        },
    });
    const exited = new Promise(resolve => parent.once('exit', resolve));
    parent.on('error', error => assert.fail(error));
    let pid;
    t.after(async () => {
        parent.kill('SIGKILL');
        await exited;
        if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
        fs.rmSync(dir, { recursive: true, force: true });
    });
    await until(() => fs.existsSync(ready));
    pid = Number(fs.readFileSync(ready, 'utf8'));
    parent.kill('SIGKILL');
    await exited;
    await until(() => !alive(pid));
});

test('Windows helper launch failures and nonzero exits fall back to direct termination without a console', async () => {
    const { EventEmitter } = await import('node:events');
    const { PassThrough } = await import('node:stream');
    const vm = await import('node:vm');
    for (const failure of ['spawn-error', 'nonzero', 'timeout']) {
        const calls = [];
        const child = new EventEmitter();
        Object.assign(child, { pid: 12345, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
        child.kill = signal => {
            calls.push(['kill-core', signal]);
            queueMicrotask(() => { child.emit('exit', null, signal); child.emit('close', null, signal); });
            return true;
        };
        const fakeSpawn = (binary, args, options) => {
            calls.push([binary, args, options]);
            if (binary === 'fixture-core.exe') {
                queueMicrotask(() => child.stdout.write('pixivbiu-desktop/1\npixivbiu-desktop/1 ready\n'));
                return child;
            }
            const killer = new EventEmitter();
            killer.kill = () => { calls.push(['kill-helper']); return true; };
            queueMicrotask(() => {
                if (failure === 'spawn-error') killer.emit('error', new Error('ENOENT'));
                if (failure === 'nonzero') killer.emit('exit', 1);
            });
            return killer;
        };
        const fakeNet = { createServer() {
            return { once() {}, address: () => ({ port: 1234 }), close: callback => callback(), listen: (_port, _host, callback) => callback() };
        } };
        const filename = path.resolve(import.meta.dirname, '../desktop/dist/core-supervisor.js');
        const localRequire = createRequire(filename);
        const exports = {};
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
            exports, Buffer, AbortSignal, AbortController, setTimeout, clearTimeout, console,
            process: { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } },
            fetch: async () => new Response('{}'),
            require: name => name === 'node:child_process' ? { spawn: fakeSpawn }
                : name === 'node:net' ? fakeNet : name === 'node:path' ? path.win32 : localRequire(name),
        }, { filename });
        const core = new exports.CoreSupervisor({
            binary: 'fixture-core.exe', env: {}, diagnostics: { append() {}, async flush() {} },
            onState() {}, stopTimeout: 5, killTimeout: 5,
        });
        await core.start();
        assert.equal(core.state, 'ready');
        await core.stop();
        assert.equal(core.state, 'stopped');
        const launch = calls[0][2];
        assert.equal(launch.windowsHide, true);
        assert.equal(launch.shell, false);
        assert.equal(launch.detached, false);
        assert.equal(Array.from(launch.stdio).join(','), 'pipe,pipe,pipe');
        const kill = calls.find(call => call[0] === 'C:\\Windows\\System32\\taskkill.exe');
        assert.ok(kill);
        assert.equal(kill[2].windowsHide, true);
        assert.equal(kill[2].shell, false);
        assert.equal(kill[2].stdio, 'ignore');
        assert.ok(calls.some(call => call[0] === 'kill-core' && call[1] === 'SIGKILL'));
    }
});


test('an HTTP 200 without the child bound-port marker cannot pass readiness', async t => {
    const { core } = fixture(t, 'foreign-health', { startupTimeout: 500 });
    await core.start();
    assert.equal(core.state, 'failed');
    assert.equal(core.failure, 'startup_timeout');
    assert.equal(core.port, null);
});
