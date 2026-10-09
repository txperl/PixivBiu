import fs from "node:fs";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { UpdateInfo } from "electron-updater";
import type { UpdateFormat } from "./update-types";

export interface PendingUpdate {
    version: string;
    format: UpdateFormat;
    file: string;
    sha512: string;
}

interface StoredUpdates {
    schema: 1;
    pending?: PendingUpdate;
    attempt?: { from: string; to: string };
}

// This main-private record is an index, never permission to execute its path.
// Every restore requires fresh feed metadata and a full hash of the cached file.
export class UpdateStore {
    private data: StoredUpdates = { schema: 1 };

    constructor(private readonly file: string) {
        try {
            if (fs.statSync(file).size > 16 * 1024) return;
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            if (data?.schema !== 1) return;
            const p = data.pending;
            if (p && typeof p.version === "string" && ["nsis", "mac", "appimage"].includes(p.format)
                && typeof p.file === "string" && path.isAbsolute(p.file) && typeof p.sha512 === "string") {
                this.data.pending = p;
            }
            if (typeof data.attempt?.from === "string" && typeof data.attempt?.to === "string") {
                this.data.attempt = data.attempt;
            }
        } catch {
            // Missing/corrupt records start empty; no cached executable is trusted.
        }
    }

    get pending(): PendingUpdate | undefined { return this.data.pending; }

    reconcile(currentVersion: string): "installed" | "failed" | undefined {
        const attempt = this.data.attempt;
        if (!attempt) return undefined;
        const result = currentVersion === attempt.to ? "installed" : "failed";
        this.commit({ ...this.data, attempt: undefined,
            pending: this.data.pending?.version === currentVersion ? undefined : this.data.pending });
        return result;
    }

    savePending(pending: PendingUpdate | undefined): void { this.commit({ ...this.data, pending }); }
    saveAttempt(from: string, to: string): void { this.commit({ ...this.data, attempt: { from, to } }); }
    clearAttempt(): void { this.commit({ ...this.data, attempt: undefined }); }

    private commit(next: StoredUpdates): void {
        const temp = `${this.file}.${randomUUID()}.tmp`;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
            const fd = fs.openSync(temp, "wx", 0o600);
            try {
                fs.writeFileSync(fd, JSON.stringify(next));
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            fs.renameSync(temp, this.file);
            this.data = next;
        } finally { fs.rmSync(temp, { force: true }); }
    }
}

export async function fileHash(file: string): Promise<string> {
    // Reject directories/symlinks and stream rather than buffering an installer.
    if (!fs.lstatSync(file).isFile()) throw new Error("invalid_update_file");
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest("base64");
}

export async function verifyPending(pending: PendingUpdate, info: UpdateInfo, format: UpdateFormat): Promise<boolean> {
    if (pending.version !== info.version || pending.format !== format) return false;
    const extension = format === "nsis" ? ".exe" : format === "mac" ? ".zip" : ".appimage";
    const matchesFeed = info.files.some(file => {
        try {
            const name = path.basename(decodeURIComponent(new URL(file.url, "https://updates.invalid/").pathname));
            return name === path.basename(pending.file) && name.toLowerCase().endsWith(extension) && file.sha512 === pending.sha512;
        } catch { return false; }
    });
    if (!matchesFeed) return false;
    try { return await fileHash(pending.file) === pending.sha512; } catch { return false; }
}
