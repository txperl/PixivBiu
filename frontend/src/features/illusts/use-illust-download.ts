import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDownloadMutations, useIllustDownloadStatus } from "@/features/downloads";
import { useMessages } from "@/i18n";

// Shared download state machine for an illust's download control — the card's
// corner button and the viewer's action cell. Kept in one place so the two can't
// drift: the "sent" check is raised ONLY when the job actually completes
// (active→inactive with a `completed` status), never on enqueue, so it can never
// override a still-running download. Enqueue rejections and task failures surface
// as `errorTitle` for the consumer to display.
export type IllustDownload = ReturnType<typeof useIllustDownload>;
export function useIllustDownload(illustId: number) {
    const m = useMessages();
    const { submit } = useDownloadMutations();
    const { job, active, percent } = useIllustDownloadStatus(illustId);
    const jobRef = useRef(job);
    jobRef.current = job;
    const [pending, setPending] = useState(false);
    const [justSent, setJustSent] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wasActiveRef = useRef(false);

    useEffect(
        () => () => {
            if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
        },
        [],
    );

    // useLayoutEffect: react to the active→inactive transition in the same paint,
    // otherwise the control briefly renders idle and flashes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: m.downloads_btn_failed is read at call time
    useLayoutEffect(() => {
        if (wasActiveRef.current && !active) {
            const terminal = jobRef.current;
            if (terminal?.status === "completed") {
                setJustSent(true);
                if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
                sentTimerRef.current = setTimeout(() => setJustSent(false), 1400);
            } else if (terminal?.status === "failed") {
                const taskError = terminal.tasks.find((t) => t.error)?.error;
                setErrorTitle(taskError ?? m.downloads_btn_failed());
            }
            // cancelled: revert silently to idle
        }
        wasActiveRef.current = active;
    }, [active]);

    const trigger = async () => {
        if (pending || active) return;
        setErrorTitle(null);
        setPending(true);
        const created = await submit(illustId);
        setPending(false);
        if (!created) setErrorTitle(m.downloads_btn_enqueue_failed());
    };

    // Treat the post-click submit window as part of "downloading" so the control
    // doesn't dwell on a separate loading state before the SSE active flag flips.
    const downloading = active || pending;
    const indeterminate = pending || percent === null;

    return { downloading, justSent, errorTitle, percent, indeterminate, trigger };
}
