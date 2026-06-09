import { useCallback, useEffect, useRef, useState } from "react";

// Copies text to the clipboard and exposes a transient `copied` flag that
// auto-resets after `resetMs`, so callers can show a "Copied" affordance without
// re-implementing the writeText + timer each time. Silent on failure (permission
// denied / insecure context / Safari).
export function useCopyToClipboard(resetMs = 1500): {
    copied: boolean;
    copy: (text: string) => Promise<void>;
} {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Cancel a pending reset if the consumer unmounts within the window.
    useEffect(() => () => clearTimeout(timerRef.current ?? undefined), []);
    const copy = useCallback(
        async (text: string) => {
            try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                clearTimeout(timerRef.current ?? undefined);
                timerRef.current = setTimeout(() => setCopied(false), resetMs);
            } catch {
                // Denied / unsupported (Safari, insecure context).
            }
        },
        [resetMs],
    );
    return { copied, copy };
}
