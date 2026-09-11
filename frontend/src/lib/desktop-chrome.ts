// Applies the Electron shell's declared window chrome as <html> data
// attributes before first paint, gating the desktop-only CSS in
// styles/desktop.css and the frameless-*/frost Tailwind variants. No-op in the
// browser (bridge absent) and under old shells (flags absent), so web
// rendering is untouched.
export function applyDesktopChrome(): () => void {
    const platform = window.pixivbiu?.platform;
    if (!platform) return () => {};
    const root = document.documentElement;
    root.dataset.desktop = platform.os;
    if (platform.frameless) root.dataset.frameless = "";
    if (platform.frost) root.dataset.frost = "";

    let nativeFullscreen = false;
    let receivedState = false;
    let disposed = false;
    const applyFullscreen = () => {
        root.toggleAttribute("data-window-fullscreen", nativeFullscreen || !!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", applyFullscreen);
    const chrome = window.pixivbiu?.windowChrome;
    // Subscribe before reading; a delayed snapshot must not overwrite an event.
    const unsubscribe = chrome?.onState((state) => {
        receivedState = true;
        nativeFullscreen = state.fullscreen;
        applyFullscreen();
    });
    void chrome
        ?.read()
        .then((state) => {
            if (disposed || receivedState) return;
            nativeFullscreen = state.fullscreen;
            applyFullscreen();
        })
        .catch(() => {
            // Keep the conservative inset when an older/incompatible shell cannot
            // supply a snapshot. Missing geometry does not imply fullscreen.
        });
    applyFullscreen();
    return () => {
        disposed = true;
        unsubscribe?.();
        document.removeEventListener("fullscreenchange", applyFullscreen);
    };
}
