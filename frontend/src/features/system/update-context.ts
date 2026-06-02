import { createContext } from "react";
import type { SystemVersion, UpdateApiError, UpdateStatus } from "./api";

export interface UpdateContextValue {
    // Cached update-check result from the backend. Null until the first load.
    status: UpdateStatus | null;
    // Build info (version + go/os/arch) for the About panel. Null until loaded.
    systemVersion: SystemVersion | null;

    // True during the initial load of status + build info.
    loading: boolean;
    // True while a manual "check now" is in flight.
    checking: boolean;
    // True after apply() is accepted, while we wait for the restarted binary.
    applying: boolean;

    // Convenience: status?.update_available ?? false. Drives the sidebar dot.
    updateAvailable: boolean;

    // Forces a fresh GitHub check and adopts the result. Returns an error to
    // surface inline, or null on success.
    checkNow: () => Promise<UpdateApiError | null>;
    // Applies the update; on success the page reloads once the new binary is
    // up (never returns in that case). Returns an error if apply was rejected.
    apply: () => Promise<UpdateApiError | null>;
}

export const UpdateContext = createContext<UpdateContextValue | null>(null);
