import { app, Menu, type MenuItemConstructorOptions } from "electron";

// installMenu sets the application menu.
//
// macOS: a minimal standard-roles menu — required for Cmd+C/V/X/A to work in
// text fields and to provide Cmd+W/H/M/Q. DevTools entries are dev-only;
// Reload stays in production as a harmless recovery tool for the local SPA.
//
// Windows/Linux: frameless/WCO windows never show a menu bar, so packaged
// builds drop the default menu entirely (which also removes its stock
// accelerators like Ctrl+Shift+I). Dev keeps Electron's default menu for
// reload/devtools.
export function installMenu(): void {
    if (process.platform !== "darwin") {
        if (app.isPackaged) Menu.setApplicationMenu(null);
        return;
    }

    const viewItems: MenuItemConstructorOptions[] = [
        { role: "reload" },
        ...(app.isPackaged ? [] : [{ role: "forceReload" as const }, { role: "toggleDevTools" as const }]),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
    ];

    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            { role: "appMenu" },
            { role: "fileMenu" },
            { role: "editMenu" },
            { label: "View", submenu: viewItems },
            { role: "windowMenu" },
        ]),
    );
}
