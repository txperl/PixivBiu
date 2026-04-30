import {
    argbFromHex,
    Hct,
    hexFromArgb,
    MaterialDynamicColors,
    SchemeTonalSpot,
} from "@material/material-color-utilities";

export const DEFAULT_SEED_COLOR = "#C8553D";

const STYLE_ELEMENT_ID = "dynamic-color-scheme";

// camelCase keys on MaterialDynamicColors → kebab-case CSS var names under --md-sys-color-*.
// Keep only tokens that shadcn or the app will actually reference; the fixed/dim extras
// from M3 aren't mapped so we skip them to keep the style tag small.
const TOKENS = [
    "primary",
    "onPrimary",
    "primaryContainer",
    "onPrimaryContainer",
    "inversePrimary",
    "secondary",
    "onSecondary",
    "secondaryContainer",
    "onSecondaryContainer",
    "tertiary",
    "onTertiary",
    "tertiaryContainer",
    "onTertiaryContainer",
    "error",
    "onError",
    "errorContainer",
    "onErrorContainer",
    "background",
    "onBackground",
    "surface",
    "onSurface",
    "surfaceDim",
    "surfaceBright",
    "surfaceVariant",
    "onSurfaceVariant",
    "surfaceContainerLowest",
    "surfaceContainerLow",
    "surfaceContainer",
    "surfaceContainerHigh",
    "surfaceContainerHighest",
    "surfaceTint",
    "inverseSurface",
    "inverseOnSurface",
    "outline",
    "outlineVariant",
    "scrim",
    "shadow",
] as const;

type TokenKey = (typeof TOKENS)[number];

const camelToKebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function buildScheme(sourceHex: string, isDark: boolean): string {
    const hct = Hct.fromInt(argbFromHex(sourceHex));
    const scheme = new SchemeTonalSpot(hct, isDark, 0);
    const colors = new MaterialDynamicColors();
    const lines: string[] = [];
    for (const key of TOKENS) {
        const argb = (colors[key as TokenKey] as () => { getArgb(s: SchemeTonalSpot): number })
            .call(colors)
            .getArgb(scheme);
        lines.push(`    --md-sys-color-${camelToKebab(key)}: ${hexFromArgb(argb)};`);
    }
    return lines.join("\n");
}

export function setColorScheme(sourceHex: string): void {
    const light = buildScheme(sourceHex, false);
    const dark = buildScheme(sourceHex, true);
    const css = `:root {\n${light}\n}\n.dark {\n${dark}\n}\n`;

    let styleEl = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = STYLE_ELEMENT_ID;
        document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
}
