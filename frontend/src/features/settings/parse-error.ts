import { apiErrorMessage } from "@/lib/api";
import type { ConfigApiError } from "./api";

export interface ParsedConfigError {
    // Per-field messages keyed by dotted path.
    fields: Record<string, string>;
    // Anything that didn't map to a known field (shown in the save bar).
    general?: string;
}

// The backend bundles validation failures as "key: msg; key2: msg2".
// We split them back apart and route each to its field; segments whose
// left side isn't a known key fall through to a general message.
export function parseConfigError(error: ConfigApiError, knownKeys: Set<string>): ParsedConfigError {
    const fields: Record<string, string> = {};
    const leftovers: string[] = [];

    for (const segment of error.message.split("; ")) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const sep = trimmed.indexOf(": ");
        const key = sep > 0 ? trimmed.slice(0, sep) : "";
        if (key && knownKeys.has(key)) {
            fields[key] = trimmed.slice(sep + 2);
        } else {
            leftovers.push(trimmed);
        }
    }

    const result: ParsedConfigError = { fields };
    if (Object.keys(fields).length === 0) {
        // Nothing mapped — surface the friendly/whole message instead.
        result.general = apiErrorMessage(error);
    } else if (leftovers.length > 0) {
        result.general = leftovers.join("；");
    }
    return result;
}
