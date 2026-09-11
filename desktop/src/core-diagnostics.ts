import fs from "node:fs/promises";
import path from "node:path";

// A bounded local snapshot complements the core's rotating business log. It
// includes failures before slog exists. Never send this raw text to the SPA.
export class CoreDiagnostics {
    private tail = Buffer.alloc(0);
    private timer?: NodeJS.Timeout;
    private writing?: Promise<void>;
    private dirty = false;

    constructor(readonly file: string, private readonly limit = 64 * 1024) {}

    append(chunk: Buffer | string): void {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.tail = Buffer.concat([this.tail, data.subarray(-this.limit)]).subarray(-this.limit);
        this.dirty = true;
        this.timer ??= setTimeout(() => { void this.flush(); }, 250);
        this.timer.unref();
    }

    async flush(): Promise<void> {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.writing) await this.writing;
        if (!this.dirty) return;
        this.dirty = false;
        const snapshot = this.tail;
        this.writing = (async () => {
            try {
                await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
                await fs.writeFile(`${this.file}.tmp`, snapshot, { mode: 0o600 });
                await fs.rename(`${this.file}.tmp`, this.file);
            } catch {
                // A read-only/full log directory must not crash the shell or
                // stop consumption of stdout/stderr. Keep the bounded memory tail.
                console.error("[core] Could not write startup diagnostics");
            }
        })();
        await this.writing;
        this.writing = undefined;
    }
}
