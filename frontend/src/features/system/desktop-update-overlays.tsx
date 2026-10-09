import LeapyOverlay from "@/components/series-leapy/leapy-overlay";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useMessages } from "@/i18n";

export function DesktopUpdateOverlays({
    applying,
    activeCount,
    cancel,
    confirm,
}: {
    applying: boolean;
    activeCount: number | null | undefined;
    cancel: () => void;
    confirm: () => void;
}) {
    const m = useMessages();
    return (
        <>
            <Dialog
                open={activeCount !== undefined}
                onOpenChange={(open) => {
                    if (!open) cancel();
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{m.settings_about_restart_confirm_title()}</DialogTitle>
                        <DialogDescription>
                            {activeCount === null
                                ? m.settings_about_restart_unknown()
                                : m.settings_about_restart_downloads({ count: activeCount ?? 0 })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={cancel}>
                            {m.common_cancel()}
                        </Button>
                        <Button onClick={confirm}>{m.settings_about_restart_update()}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {applying && <LeapyOverlay label={m.settings_about_restart_preparing()} />}
        </>
    );
}
