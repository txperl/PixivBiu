import LeapyLoading from "./leapy-loading";

/**
 * Full-screen "waiting on the backend" overlay: the leaping dots sit centered
 * while the status text is pinned to the bottom-left corner, the way a browser
 * shows its loading state. Shared by the config-restart and update-apply flows.
 *
 * The text is absolutely positioned (out of flow), so the dots' vertical leap
 * never crowds it — the old stacked layout had them nearly touching.
 */
function LeapyOverlay({ label }: { label: string }) {
    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur"
        >
            <LeapyLoading size={20} />
            <span
                className="fade-in slide-in-from-bottom-2 absolute bottom-6 left-6 max-w-sm animate-in text-muted-foreground text-sm duration-500"
                style={{ animationFillMode: "backwards" }}
            >
                {label}
            </span>
        </div>
    );
}

export default LeapyOverlay;
