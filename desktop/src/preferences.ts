import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// This is a UI preference store, never a credential or arbitrary file bridge.
export const PREFERENCE_KEYS = [
    "PARAGLIDE_LOCALE",
    "pixivbiu.general-filters",
    "pixivbiu.search.history.v1",
    "pixivbiu.activity-bar",
] as const;
const MAX_VALUE_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 300 * 1024;

function validEntry(key: unknown, value: unknown): key is string {
    return typeof key === "string" && (PREFERENCE_KEYS as readonly string[]).includes(key)
        && typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_VALUE_BYTES;
}

export class PreferenceStore {
    private values: Record<string, string> = {};

    constructor(private readonly file: string) {
        try {
            if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error("oversized preferences");
            const data = JSON.parse(fs.readFileSync(file, "utf8"));
            if (data?.version !== 1 || !data.values || typeof data.values !== "object") {
                throw new Error("invalid preferences");
            }
            for (const [key, value] of Object.entries(data.values)) {
                if (validEntry(key, value)) this.values[key] = value as string;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                console.warn("[preferences] Could not restore UI preferences; using defaults");
            }
        }
    }

    read(): Record<string, string> {
        return { ...this.values };
    }

    // Small, synchronous atomic commits: acknowledgements mean the write has
    // finished, and quit does not race a deferred/debounced persistence queue.
    write(key: unknown, value: unknown): void {
        if (!validEntry(key, value)) throw new Error("invalid_preference");
        if (this.values[key] === value) return;
        const next = { ...this.values, [key]: value as string };
        const data = JSON.stringify({ version: 1, values: next });
        if (Buffer.byteLength(data, "utf8") > MAX_FILE_BYTES) throw new Error("invalid_preference");
        const temp = `${this.file}.${randomUUID()}.tmp`;
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
            const fd = fs.openSync(temp, "wx", 0o600);
            try {
                fs.writeFileSync(fd, data);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            fs.renameSync(temp, this.file);
            this.values = next;
        } catch {
            throw new Error("preference_write_failed");
        } finally {
            fs.rmSync(temp, { force: true });
        }
    }
}
