import fs from "node:fs/promises";
import path from "node:path";
import type { AppUpdater, UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import { CancellationToken } from "electron-updater";
import { UpdateStore, verifyPending, type PendingUpdate } from "./update-store";
import type { UpdateErrorCode, UpdateFormat, UpdateSnapshot } from "./update-types";

type Driver = Pick<AppUpdater, "on" | "checkForUpdates" | "downloadUpdate" | "quitAndInstall" | "autoDownload" | "autoInstallOnAppQuit">;
interface Options {
    currentVersion: string;
    format: UpdateFormat;
    packaged: boolean;
    store: UpdateStore;
    prepareQuit(): Promise<void>;
    resume(): void;
    send(snapshot: UpdateSnapshot): void;
    log(action: string, error?: unknown): void;
    links(info: UpdateInfo): Promise<{ releaseUrl?: string; installerUrl?: string }>;
    notes(info: UpdateInfo): Promise<string | undefined>;
    appImageFile?: string;
}

function normalizeNotes(notes: UpdateInfo["releaseNotes"]): string | undefined {
    if (typeof notes === "string") return notes;
    return notes?.map(note => note.note ?? "").filter(Boolean).join("\n\n") || undefined;
}

export class UpdateController {
    private snapshot: UpdateSnapshot;
    private info?: UpdateInfo;
    private ready = false;
    private checkOperation?: Promise<void>;
    private downloadOperation?: Promise<void>;
    private installOperation?: Promise<void>;
    private downloaded?: UpdateDownloadedEvent;
    private prepared = false;
    private installError?: Error;
    private closing = false;
    private downloadToken?: CancellationToken;
    private installBlocked = false;

    constructor(private readonly driver: Driver, private readonly options: Options) {
        driver.autoDownload = false;
        driver.autoInstallOnAppQuit = false;
        this.snapshot = { sequence: 0, currentVersion: options.currentVersion, format: options.format,
            installMode: !options.packaged ? "disabled" : ["nsis", "mac", "appimage"].includes(options.format) ? "in-app" : "external",
            state: "idle" };
        try {
            const result = options.store.reconcile(options.currentVersion);
            if (result) options.log(`previous-install-${result}`);
            if (result === "failed") this.snapshot.previousInstallFailed = true;
        } catch (error) { options.log("restore-attempt-failed", error); }
        driver.on("download-progress", progress => {
            if (!this.downloadOperation || this.snapshot.state !== "downloading") return;
            this.publish({ percent: Math.max(0, Math.min(100, Math.round(progress.percent) || 0)) });
        });
        driver.on("update-downloaded", info => {
            // MacUpdater resolves downloadUpdate() with [] when automatic install
            // is disabled; the event owns the actual cached ZIP path on all OSes.
            if ((this.downloadOperation || this.installOperation) && info.version === this.info?.version) this.downloaded = info;
        });
        driver.on("error", error => {
            options.log("updater-error", error);
            if (!this.prepared) return; // awaited operations classify their errors
            this.installError = new Error("install_failed");
            this.prepared = false;
            this.blockInstall();
            options.resume();
            this.fail("install_failed", error);
        });
    }

    read(): UpdateSnapshot { return { ...this.snapshot }; }

    beginQuit(): void {
        if (this.prepared) return; // the explicit installer already owns this quit
        this.closing = true;
        this.downloadToken?.cancel();
    }

    cancelQuit(): void {
        if (!this.closing) return;
        this.closing = false;
        if (this.installBlocked) return;
        this.publish({ state: this.ready ? "downloaded" : this.info ? "available" : "idle", error: undefined, percent: undefined });
    }

    private assertOpen(): void {
        if (this.closing) throw new Error("update_cancelled");
    }

    private publish(patch: Partial<UpdateSnapshot>): void {
        if (this.closing) return;
        this.snapshot = { ...this.snapshot, ...patch, readyToInstall: this.ready, sequence: this.snapshot.sequence + 1 };
        this.options.send(this.read());
    }

    private fail(code: UpdateErrorCode, error: unknown): Error {
        this.options.log(code, error);
        this.publish({ state: "error", error: code, percent: undefined });
        return new Error(code);
    }

    private requireInApp(): void {
        if (this.snapshot.installMode !== "in-app") throw new Error("not_supported");
        if (this.installBlocked) throw new Error("install_failed");
    }

    private blockInstall(): void {
        // Public updater APIs cannot reset a failed handoff on every platform
        // (BaseUpdater's quit flag and native macOS listeners can remain set).
        // Keep Core usable, but require a new process or the official package.
        this.installBlocked = true;
        this.ready = false;
        this.publish({ installRecoveryRequired: true });
    }

    check(): Promise<void> {
        if (this.installBlocked) return Promise.resolve();
        if (this.checkOperation) return this.checkOperation;
        if (this.downloadOperation || this.installOperation || this.prepared) return Promise.resolve();
        if (this.snapshot.installMode === "disabled") return Promise.resolve();
        this.checkOperation = Promise.resolve().then(async () => {
            this.assertOpen();
            this.ready = false;
            this.publish({ state: "checking", error: undefined });
            try {
                const result = await this.driver.checkForUpdates();
                this.assertOpen();
                if (!result) throw new Error("updater_unavailable");
                this.info = result.isUpdateAvailable ? result.updateInfo : undefined;
                this.ready = false;
                if (!this.info) {
                    this.options.store.savePending(undefined);
                    this.publish({ state: "not-available", version: undefined, notes: undefined, releaseUrl: undefined,
                        installerUrl: undefined, publishedAt: undefined, lastChecked: new Date().toISOString() });
                    return;
                }
                const info = this.info;
                const pending = this.options.store.pending;
                this.ready = !!pending && this.snapshot.installMode === "in-app" && await verifyPending(pending, info, this.options.format);
                if (pending && !this.ready) this.options.store.savePending(undefined);
                const links = await this.options.links(info);
                this.publish({ state: this.ready ? "downloaded" : "available", version: info.version,
                    notes: normalizeNotes(info.releaseNotes), publishedAt: info.releaseDate,
                    lastChecked: new Date().toISOString(), percent: undefined, ...links });
                // Notes only enrich the same offer; never regress the operation state.
                void this.options.notes(info).then(notes => {
                    if (notes && this.info === info && this.snapshot.notes !== notes) this.publish({ notes });
                }).catch(error => this.options.log("notes-unavailable", error));
            } catch (error) { this.info = undefined; this.ready = false; throw this.fail("check_failed", error); }
        }).finally(() => { this.checkOperation = undefined; });
        return this.checkOperation;
    }

    download(): Promise<void> {
        this.requireInApp();
        if (this.downloadOperation) return this.downloadOperation;
        if (this.installOperation || this.prepared) return Promise.resolve();
        this.downloadOperation = Promise.resolve().then(async () => {
            if (this.checkOperation) await this.checkOperation;
            this.assertOpen();
            if (!this.info) throw this.fail("check_failed", new Error("missing_verified_offer"));
            if (this.ready) { this.publish({ state: "downloaded", error: undefined }); return; }
            this.downloaded = undefined;
            this.publish({ state: "downloading", error: undefined, percent: 0 });
            let code: UpdateErrorCode = "download_failed";
            try {
                this.downloadToken = new CancellationToken();
                await this.driver.downloadUpdate(this.downloadToken);
                this.assertOpen();
                code = "verification_failed";
                // EventEmitter mutates this field during the awaited download.
                const event = this.downloaded as UpdateDownloadedEvent | undefined;
                if (!event) throw new Error("missing_download_event");
                const file = event.files.find(file => {
                    try { return path.basename(decodeURIComponent(new URL(file.url, "https://updates.invalid/").pathname)) === path.basename(event.downloadedFile); }
                    catch { return false; }
                });
                if (!file?.sha512) throw new Error("missing_checksum");
                const pending: PendingUpdate = { version: event.version, format: this.options.format, file: event.downloadedFile, sha512: file.sha512 };
                if (!await verifyPending(pending, this.info, this.options.format)) throw new Error("invalid_cached_update");
                this.options.store.savePending(pending);
                this.ready = true;
                this.publish({ state: "downloaded", percent: undefined });
            } catch (error) { this.ready = false; throw this.fail(code, error); }
        }).catch(error => {
            if (this.snapshot.state !== "error") throw this.fail("download_failed", error);
            throw error;
        }).finally(() => { this.downloadOperation = undefined; this.downloadToken = undefined; });
        return this.downloadOperation;
    }

    restartAndInstall(): Promise<void> {
        this.requireInApp();
        if (this.installOperation) return this.installOperation;
        if (this.prepared) return Promise.resolve();
        this.installOperation = Promise.resolve().then(async () => {
            if (this.checkOperation) await this.checkOperation;
            this.assertOpen();
            if (!this.ready || !this.info) throw new Error("verification_failed");
            this.publish({ state: "preparing-install", error: undefined });
            let code: UpdateErrorCode = "verification_failed";
            try {
                const pending = this.options.store.pending;
                if (!pending || !await verifyPending(pending, this.info, this.options.format)) {
                    this.ready = false;
                    this.options.store.savePending(undefined);
                    throw new Error("invalid_cached_update");
                }
                if (this.options.format === "appimage") {
                    if (!this.options.appImageFile) throw new Error("missing_appimage");
                    await fs.access(this.options.appImageFile, fs.constants.W_OK);
                    await fs.access(path.dirname(this.options.appImageFile), fs.constants.W_OK);
                }
                // Rehydrate the library's cache/session after a relaunch. Persisted
                // paths are never passed to spawn or used as an installer command.
                await this.driver.downloadUpdate();
                this.assertOpen();
                this.options.store.saveAttempt(this.options.currentVersion, this.info.version);
                code = "stop_failed";
                await this.options.prepareQuit();
                this.assertOpen();
                this.prepared = true;
                this.installError = undefined;
                code = "install_failed";
                this.publish({ state: "installing" });
                this.driver.quitAndInstall(true, true);
                if (this.installError) throw this.installError;
            } catch (error) {
                if (this.prepared) { this.prepared = false; this.blockInstall(); this.options.resume(); }
                try { this.options.store.clearAttempt(); } catch (writeError) { this.options.log("clear-attempt-failed", writeError); }
                throw this.fail(code, error);
            }
        }).catch(error => {
            if (this.snapshot.state !== "error") throw this.fail("verification_failed", error);
            throw error;
        }).finally(() => { this.installOperation = undefined; });
        return this.installOperation;
    }

    async downloadAndInstall(): Promise<void> {
        await this.download();
        await this.restartAndInstall();
    }
}
