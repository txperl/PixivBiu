import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CoreDiagnostics } from "./core-diagnostics";

// Mirrored by cmd/server/desktop.go. Only a managed child may request respawn.
export const DESKTOP_PROTOCOL_MARKER = "pixivbiu-desktop/1";
const RESTART_EXIT_CODE = 75;
const PORT_BUSY_EXIT_CODE = 76;
export type CoreState = "starting" | "ready" | "restarting" | "failed" | "stopping" | "stopped";
export type CoreFailure = "start_failed" | "incompatible_core" | "startup_timeout" | "core_exited" | "stop_failed";
type Exit = { code: number | null; signal: NodeJS.Signals | null; error?: Error };
type Attempt = {
    child: ChildProcessWithoutNullStreams;
    port: number;
    handshake: boolean;
    listening: boolean;
    result?: Exit;
    exited: Promise<Exit>;
};
type Options = {
    binary: string;
    args?: string[];
    env: NodeJS.ProcessEnv;
    diagnostics: CoreDiagnostics;
    onState: (state: CoreState, failure?: CoreFailure) => void;
    // Shorter deadlines for process-fixture tests.
    startupTimeout?: number;
    stopTimeout?: number;
    killTimeout?: number;
};

async function findFreePort(): Promise<number> {
    const server = net.createServer();
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("could not select core port"));
                return;
            }
            server.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}

// A race with a cleared timer, so fast shutdown never leaves a deadline alive.
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([promise, new Promise<undefined>(resolve => {
            timer = setTimeout(() => resolve(undefined), ms);
        })]);
    } finally {
        clearTimeout(timer);
    }
}

export class CoreSupervisor {
    port: number | null = null;
    state: CoreState = "stopped";
    failure?: CoreFailure;
    private attempt?: Attempt;
    private operation?: Promise<void>;
    private stopping?: Promise<void>;
    private quitting = false;
    private cancel = new AbortController();

    constructor(private readonly options: Options) {}

    get pid(): number | null {
        return this.attempt && !this.attempt.result ? this.attempt.child.pid ?? null : null;
    }

    private transition(state: CoreState, failure?: CoreFailure): void {
        this.state = state;
        this.failure = failure;
        this.options.diagnostics.append(`\n[desktop] ${state}${failure ? `: ${failure}` : ""}\n`);
        this.options.onState(state, failure);
    }

    start(): Promise<void> {
        if (this.quitting || this.state === "ready") return Promise.resolve();
        if (this.operation) return this.operation;
        this.operation = this.launch().finally(() => { this.operation = undefined; });
        return this.operation;
    }

    private spawn(port: number): Attempt {
        const child = spawn(this.options.binary, [...(this.options.args ?? []), "-desktop-managed=1"], {
            env: { ...this.options.env, PIXIVBIU_SERVER_PORT: String(port) },
            windowsHide: true,
            shell: false,
            detached: false,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const attempt: Attempt = { child, port, handshake: false, listening: false, exited: Promise.resolve({ code: null, signal: null }) };
        attempt.exited = new Promise(resolve => {
            child.on("error", error => {
                this.options.diagnostics.append(`[spawn] ${error.message}\n`);
                // Kill errors can occur on a live process; do not mark it dead.
                if (child.pid === undefined) attempt.result = { code: null, signal: null, error };
            });
            child.once("exit", (code, signal) => { attempt.result = { code, signal }; });
            // Drain final stderr before flushing diagnostics or starting a successor.
            child.once("close", (code, signal) => {
                attempt.result ??= { code, signal };
                resolve(attempt.result);
            });
        });
        this.options.diagnostics.append(`[spawn] pid=${child.pid ?? "unavailable"}\n`);
        child.stdin.on("error", () => {}); // EPIPE during exit is expected.
        let line = "";
        let firstLine = true;
        child.stdout.on("data", (chunk: Buffer) => {
            this.options.diagnostics.append(chunk);
            if (attempt.listening) return;
            for (const [index, part] of chunk.toString("utf8").split("\n").entries()) {
                if (index > 0) {
                    if (firstLine) {
                        attempt.handshake = line === DESKTOP_PROTOCOL_MARKER;
                        firstLine = false;
                    } else if (attempt.handshake && line === `${DESKTOP_PROTOCOL_MARKER} ready`) {
                        attempt.listening = true;
                    }
                    line = "";
                }
                line = (line + part).slice(0, 256);
            }
        });
        child.stderr.on("data", (chunk: Buffer) => this.options.diagnostics.append(chunk));
        for (const stream of [child.stdout, child.stderr]) {
            stream.on("error", () => this.options.diagnostics.append("[core] diagnostic pipe failed\n"));
        }
        return attempt;
    }

    private async ready(attempt: Attempt): Promise<void> {
        const deadline = Date.now() + (this.options.startupTimeout ?? 20_000);
        while (!this.quitting && !attempt.result && Date.now() < deadline) {
            if (attempt.handshake && attempt.listening) {
                try {
                    const response = await fetch(`http://127.0.0.1:${attempt.port}/api/v1/health`, {
                        signal: AbortSignal.any([this.cancel.signal, AbortSignal.timeout(1_000)]),
                    });
                    const ok = response.ok;
                    await response.body?.cancel();
                    if (ok && !attempt.result && !this.quitting) return;
                } catch { /* Not ready yet. */ }
            }
            await delay(100, undefined, { signal: this.cancel.signal }).catch(() => {});
        }
        throw new Error("core not ready");
    }

    private async launch(): Promise<void> {
        this.transition(this.state === "restarting" ? "restarting" : "starting");
        let failure: CoreFailure = "start_failed";
        try {
            for (let tries = 0; tries < 3 && !this.quitting; tries++) {
                // Retry is permitted only after the preceding child has exited.
                if (this.attempt && !await this.terminate(this.attempt)) {
                    failure = "stop_failed";
                    break;
                }
                const port = await findFreePort();
                if (this.quitting) return;
                const attempt = this.spawn(port);
                this.attempt = attempt;
                try {
                    await this.ready(attempt);
                    this.port = port;
                    this.transition("ready");
                    void attempt.exited.then(result => this.onExit(attempt, result));
                    return;
                } catch {
                    if (this.quitting) return;
                    failure = attempt.result?.error ? "start_failed"
                        : !attempt.handshake ? "incompatible_core"
                        : attempt.result ? "start_failed" : "startup_timeout";
                    if (!await this.terminate(attempt)) {
                        failure = "stop_failed";
                        break;
                    }
                    if (attempt.handshake && attempt.result?.code === PORT_BUSY_EXIT_CODE) continue;
                    break;
                }
            }
        } catch (error) {
            this.options.diagnostics.append(`[startup] ${String(error)}\n`);
        }
        if (!this.quitting) {
            this.port = null;
            this.transition("failed", failure);
            await this.options.diagnostics.flush();
        }
    }

    private async onExit(attempt: Attempt, result: Exit): Promise<void> {
        if (this.attempt !== attempt || this.quitting) return;
        this.port = null;
        this.options.diagnostics.append(`[exit] code=${result.code} signal=${result.signal}\n`);
        if (result.code === RESTART_EXIT_CODE && attempt.handshake) {
            this.transition("restarting");
            // Let the completed startup operation relinquish its single-flight slot.
            await this.operation;
            if (!this.quitting) await this.start();
        } else {
            this.transition("failed", "core_exited");
            await this.options.diagnostics.flush();
        }
    }

    private async terminate(attempt: Attempt): Promise<boolean> {
        if (attempt.result) {
            if (!await within(attempt.exited, this.options.killTimeout ?? 3_000)) {
                attempt.child.stdout.destroy();
                attempt.child.stderr.destroy();
            }
            return true;
        }
        // Closing the lease also covers a child that cannot parse the command.
        attempt.child.stdin.end("stop\n");
        if (await within(attempt.exited, this.options.stopTimeout ?? 10_000)) return true;
        if (process.platform === "win32" && attempt.child.pid !== undefined) {
            // Never shell-expand a PID or resolve taskkill from a writable CWD.
            const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
            const killer = spawn(taskkill, ["/PID", String(attempt.child.pid), "/T", "/F"], {
                windowsHide: true, shell: false, stdio: "ignore",
            });
            const done = new Promise<boolean>(resolve => {
                killer.once("error", () => resolve(false));
                killer.once("exit", code => resolve(code === 0));
            });
            if (!await within(done, this.options.killTimeout ?? 3_000)) {
                killer.kill();
                attempt.child.kill("SIGKILL");
            }
        } else {
            attempt.child.kill("SIGKILL");
        }
        return !!await within(attempt.exited, this.options.killTimeout ?? 3_000);
    }

    stop(): Promise<void> {
        if (this.stopping) return this.stopping;
        this.quitting = true;
        this.cancel.abort();
        this.port = null;
        this.transition("stopping");
        this.stopping = (async () => {
            // Startup observes quitting before spawning, and otherwise leaves
            // its current child here for exactly one shutdown operation.
            await this.operation;
            const stopped = !this.attempt || await this.terminate(this.attempt);
            this.transition(stopped ? "stopped" : "failed", stopped ? undefined : "stop_failed");
            await this.options.diagnostics.flush();
        })().finally(() => {
            // A failed OS termination can be retried by closing the app again.
            if (this.state === "failed") this.stopping = undefined;
        });
        return this.stopping;
    }
}
