// Main-process snapshots contain authored error codes, never raw diagnostics or paths.
export type UpdateErrorCode = "check_failed" | "download_failed" | "verification_failed" | "stop_failed" | "install_failed" | "not_supported";
export type UpdateFormat = "nsis" | "mac" | "appimage" | "deb" | "rpm" | "unsupported";

export interface UpdateSnapshot {
    sequence: number;
    currentVersion: string;
    format: UpdateFormat;
    installMode: "in-app" | "external" | "disabled";
    state: "idle" | "checking" | "not-available" | "available" | "downloading" | "downloaded" | "preparing-install" | "installing" | "error";
    version?: string;
    notes?: string;
    releaseUrl?: string;
    installerUrl?: string;
    publishedAt?: string;
    lastChecked?: string;
    percent?: number;
    readyToInstall?: boolean;
    error?: UpdateErrorCode;
    previousInstallFailed?: boolean;
    installRecoveryRequired?: boolean;
}
