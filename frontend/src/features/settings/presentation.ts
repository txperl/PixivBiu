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

// Top offset (px) used when scroll-spy jumps to a section, so the heading
// isn't flush against the scroll container's edge.
export const SCROLL_OFFSET = 24;

interface SectionMeta {
    title: string;
    icon: IconSvgElement;
    order: number;
}

// Frontend presentation overlay: friendly section titles, icons, and order.
// Everything else (fields, types, constraints) comes from GET /config/schema.
export const SECTION_META: Record<string, SectionMeta> = {
    server: { title: "服务器", icon: CloudServerIcon, order: 0 },
    log: { title: "日志", icon: Note01Icon, order: 1 },
    pixiv: { title: "Pixiv", icon: Image01Icon, order: 2 },
    download: { title: "下载", icon: Download04Icon, order: 3 },
    inbox: { title: "事件队列", icon: InboxIcon, order: 4 },
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
