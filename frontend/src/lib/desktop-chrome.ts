// Applies the Electron shell's declared window chrome as <html> data
// attributes before first paint, gating the desktop-only CSS in
// styles/desktop.css and the frameless-*/frost Tailwind variants. No-op in the
// browser (bridge absent) and under old shells (flags absent), so web
// rendering is untouched.
export function applyDesktopChrome(): void {
    const platform = window.pixivbiu?.platform;
    if (!platform) return;
    const root = document.documentElement;
    root.dataset.desktop = platform.os;
    if (platform.frameless) root.dataset.frameless = "";
    if (platform.frost) root.dataset.frost = "";
}
