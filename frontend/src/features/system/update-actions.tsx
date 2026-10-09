import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useMessages } from "@/i18n";
import { useUpdate } from "./use-update";

// Both About and release notes use the same action/capability decision.
export function UpdateActions({ onApply, disabled = false }: { onApply: () => void; disabled?: boolean }) {
    const m = useMessages();
    const { desktopUpdate, twoPhaseUpdates, applying, actionPending, checking } = useUpdate();
    if (twoPhaseUpdates && desktopUpdate?.installRecoveryRequired) return null;
    if (twoPhaseUpdates && desktopUpdate?.installMode === "external") {
        return (
            <>
                {(desktopUpdate.installerUrl ?? desktopUpdate.releaseUrl) && (
                    <Button
                        size="sm"
                        nativeButton={false}
                        render={
                            <a
                                href={desktopUpdate.installerUrl ?? desktopUpdate.releaseUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {m.settings_about_get_installer()}
                            </a>
                        }
                    />
                )}
                <Dialog>
                    <DialogTrigger render={<Button variant="outline" size="sm" />}>
                        {m.settings_about_upgrade_instructions()}
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{m.settings_about_upgrade_instructions()}</DialogTitle>
                            <DialogDescription>{m.settings_about_external_upgrade_help()}</DialogDescription>
                        </DialogHeader>
                    </DialogContent>
                </Dialog>
            </>
        );
    }
    let label = m.settings_about_apply();
    if (twoPhaseUpdates) {
        label =
            desktopUpdate?.state === "downloading"
                ? m.settings_about_downloading()
                : desktopUpdate?.readyToInstall
                  ? m.settings_about_restart_update()
                  : m.settings_about_download_update();
    }
    return (
        <Button
            onClick={onApply}
            size="sm"
            disabled={
                disabled ||
                applying ||
                actionPending ||
                checking ||
                desktopUpdate?.state === "downloading" ||
                desktopUpdate?.error === "check_failed" ||
                (twoPhaseUpdates && desktopUpdate?.installMode !== "in-app")
            }
        >
            {label}
        </Button>
    );
}

export function DesktopUpdateFeedback() {
    const m = useMessages();
    const { desktopUpdate, desktopError, twoPhaseUpdates } = useUpdate();
    if (!twoPhaseUpdates) return null;
    const errors = {
        check_failed: m.settings_about_check_failed(),
        download_failed: m.settings_about_update_download_failed(),
        verification_failed: m.settings_about_update_verification_failed(),
        stop_failed: m.settings_about_update_stop_failed(),
        install_failed: m.settings_about_update_install_failed(),
        not_supported: m.settings_about_external_upgrade_help(),
    };
    return (
        <div className="space-y-2 text-xs" aria-live="polite">
            {desktopUpdate?.state === "downloading" && (
                <>
                    <p className="m-0 text-muted-foreground">
                        {m.settings_about_download_progress({ percent: desktopUpdate.percent ?? 0 })}
                    </p>
                    <Progress value={desktopUpdate.percent ?? 0} aria-label={m.settings_about_downloading()} />
                </>
            )}
            {desktopUpdate?.readyToInstall && (
                <p className="m-0 text-muted-foreground">{m.settings_about_download_ready()}</p>
            )}
            {desktopError && <p className="m-0 text-destructive">{errors[desktopError]}</p>}
            {desktopError === "install_failed" && desktopUpdate?.releaseUrl && (
                <a className="underline" href={desktopUpdate.releaseUrl} target="_blank" rel="noreferrer">
                    {m.settings_about_get_installer()}
                </a>
            )}
            {desktopUpdate?.previousInstallFailed && (
                <p className="m-0 text-muted-foreground">
                    {m.settings_about_previous_install_failed()}{" "}
                    {desktopUpdate.releaseUrl && (
                        <a className="underline" href={desktopUpdate.releaseUrl} target="_blank" rel="noreferrer">
                            {m.settings_about_get_installer()}
                        </a>
                    )}
                </p>
            )}
        </div>
    );
}
