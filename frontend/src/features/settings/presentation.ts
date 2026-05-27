import {
    CloudServerIcon,
    Download04Icon,
    Image01Icon,
    InboxIcon,
    Note01Icon,
    Settings03Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
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

interface SectionMeta {
    icon: IconSvgElement;
    order: number;
}

// Frontend presentation overlay: section icons and order only. Titles and
// descriptions are i18n keys resolved at render time via useSectionTitle() /
// useSectionDescription() (keyed by the section id). Everything else (fields,
// types, constraints) comes from GET /config/schema.
export const SECTION_META: Record<string, SectionMeta> = {
    server: { icon: CloudServerIcon, order: 0 },
    log: { icon: Note01Icon, order: 1 },
    pixiv: { icon: Image01Icon, order: 2 },
    download: { icon: Download04Icon, order: 3 },
    inbox: { icon: InboxIcon, order: 4 },
};

export const FALLBACK_SECTION_ICON: IconSvgElement = Settings03Icon;

// Per-key control override where the schema type alone is insufficient.
// Go text/template fields read better in a multi-line monospace box.
export const CONTROL_OVERRIDE: Record<string, ControlKind> = {
    "download.output_dir": "textarea",
    "download.file_template": "textarea",
    "download.file_group_template": "textarea",
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
