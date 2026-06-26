import {
    CloudServerIcon,
    Download04Icon,
    GlobalIcon,
    Image01Icon,
    InformationCircleIcon,
    PaintBoardIcon,
    Settings03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { FILE_KEY, GROUP_KEY, OUTPUT_DIR_KEY } from "./naming-tokens";
import type { ControlKind, FieldSpec } from "./types";

// Must match config.SchemaVersion in the Go backend. A mismatch surfaces a
// non-blocking warning banner (the typed ConfigView still drives values).
export const EXPECTED_SCHEMA_VERSION = "1";

// The settings page is framed by one fixed top bar; everything that needs to
// clear it derives from this single height so the bar, the sticky nav, the
// scroll-spy landing point, and the observer's occluded strip never drift.
export const HEADER_HEIGHT = 64; // matches the bar's h-16
// Must equal the content wrapper's top padding (pt-6 = 24px). The sticky nav
// then pins exactly where it already sits in normal flow, so it locks from the
// first pixel of scroll instead of drifting up to a lower sticky line first.
export const CONTENT_TOP_GAP = 24;

// Where scroll-spy lands a section and where the sticky nav pins: just below
// the fixed bar, so headings aren't hidden behind it.
export const SCROLL_OFFSET = HEADER_HEIGHT + CONTENT_TOP_GAP;
export const NAV_TOP = HEADER_HEIGHT + CONTENT_TOP_GAP;

// Frontend presentation overlay: one section-id → icon registry. Section ORDER
// is no longer carried here — it's derived from the schema (each category's
// earliest x-cfg-order, see compileSchema), so the struct declaration order is
// the single source of truth and this map can't drift out of sync with it.
// Titles and descriptions are i18n keys resolved at render time via
// useSectionTitle() / useSectionDescription() (keyed by the section id);
// everything else (fields, types, constraints) comes from GET /config/schema.
// `about` is rendered by a bespoke card (SettingsAbout) rather than as a normal
// section, but its icon lives here too so every section icon has one home.
// Section ids mirror the backend cfg:"category=..." tags: `system` groups the
// server/log/inbox runtime internals, and the search knob rides under `pixiv`.
export const SECTION_ICONS: Record<string, IconSvgElement> = {
    app: GlobalIcon,
    pixiv: PaintBoardIcon,
    download: Download04Icon,
    image: Image01Icon,
    system: CloudServerIcon,
    about: InformationCircleIcon,
};

export const FALLBACK_SECTION_ICON: IconSvgElement = Settings03Icon;

// Per-key control override where the schema type alone is insufficient.
// The Go text/template path/filename fields get the dedicated "template"
// control: a monospace box plus a token-insertion palette and a live preview.
// pixiv.proxy gets the "proxy" control: its secret input plus a button that
// fills in the OS system proxy (overrides the sensitive→password default).
export const CONTROL_OVERRIDE: Record<string, ControlKind> = {
    [OUTPUT_DIR_KEY]: "template",
    [FILE_KEY]: "template",
    [GROUP_KEY]: "template",
    "pixiv.proxy": "proxy",
};

// Advanced and internal (program-only) fields form one lower-priority tier:
// hidden behind the "advanced options" toggle, visually banded, and sorted to
// the bottom. The visibility check, the banding, and the ordering all share
// this single predicate so the three never drift apart.
export function isAdvanced(field: FieldSpec): boolean {
    return field.advanced || field.internal;
}

export function isFieldVisible(field: FieldSpec, showAdvanced: boolean): boolean {
    return showAdvanced || !isAdvanced(field);
}
