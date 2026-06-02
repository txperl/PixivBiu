import { useMessages } from "@/i18n";
import type { FieldSpec } from "./types";

// Settings i18n resolvers.
//
// Design: each hook calls useMessages() (subscribing the component to locale
// changes) and returns a resolver backed by an EXPLICIT STATIC MAP. We never do
// m[dynamicKey]() — that breaks Paraglide tree-shaking and types — so every
// entry names a concrete m.cfg_* / m.settings_section_* function literally.
//
// Each resolver falls back to the field's own Chinese description / the raw
// section id when a key is absent, so an unknown backend field still renders.
//
// Naming bridge: a dotted field.key like "pixiv.proxy" maps to m.cfg_pixiv_proxy
// (prefix "cfg_" + field.key.replaceAll(".", "_")); a section id like "download"
// maps to m.settings_section_download.

export function useFieldText(): (field: FieldSpec) => string {
    const m = useMessages();
    // Keyed by `cfg_` + field.key.replaceAll(".", "_"). Covers all 26 leaf
    // fields; anything else falls through to field.description / field.key.
    const map: Record<string, () => string> = {
        cfg_app_language: () => m.cfg_app_language(),
        cfg_app_open_browser: () => m.cfg_app_open_browser(),
        cfg_app_update_enabled: () => m.cfg_app_update_enabled(),
        cfg_app_update_channel: () => m.cfg_app_update_channel(),
        cfg_server_host: () => m.cfg_server_host(),
        cfg_server_port: () => m.cfg_server_port(),
        cfg_server_port_fallback: () => m.cfg_server_port_fallback(),
        cfg_server_timeouts_read: () => m.cfg_server_timeouts_read(),
        cfg_server_timeouts_write: () => m.cfg_server_timeouts_write(),
        cfg_server_timeouts_shutdown: () => m.cfg_server_timeouts_shutdown(),
        cfg_log_level: () => m.cfg_log_level(),
        cfg_log_format: () => m.cfg_log_format(),
        cfg_pixiv_proxy: () => m.cfg_pixiv_proxy(),
        cfg_pixiv_bypass_sni: () => m.cfg_pixiv_bypass_sni(),
        cfg_pixiv_state_file: () => m.cfg_pixiv_state_file(),
        cfg_download_output_dir: () => m.cfg_download_output_dir(),
        cfg_download_file_template: () => m.cfg_download_file_template(),
        cfg_download_file_group_template: () => m.cfg_download_file_group_template(),
        cfg_download_max_concurrent: () => m.cfg_download_max_concurrent(),
        cfg_download_http_timeout: () => m.cfg_download_http_timeout(),
        cfg_download_retry_max: () => m.cfg_download_retry_max(),
        cfg_download_retry_initial_backoff: () => m.cfg_download_retry_initial_backoff(),
        cfg_download_referer: () => m.cfg_download_referer(),
        cfg_download_pximg_base: () => m.cfg_download_pximg_base(),
        cfg_download_ugoira_format: () => m.cfg_download_ugoira_format(),
        cfg_download_store_file: () => m.cfg_download_store_file(),
        cfg_inbox_buffer_size: () => m.cfg_inbox_buffer_size(),
        cfg_inbox_progress_throttle: () => m.cfg_inbox_progress_throttle(),
        cfg_inbox_heartbeat: () => m.cfg_inbox_heartbeat(),
    };
    return (field: FieldSpec) => {
        const key = `cfg_${field.key.replaceAll(".", "_")}`;
        return map[key]?.() ?? field.description ?? field.key;
    };
}

// useNamingFieldLabel resolves an "insert field" menu id (see NAMING_MENU in
// naming-tokens.ts) to its localized label, via the same explicit-static-map
// pattern as useFieldText. Falls back to the raw id if a label is absent.
export function useNamingFieldLabel(): (id: string) => string {
    const m = useMessages();
    const map: Record<string, () => string> = {
        id: () => m.settings_template_field_id(),
        title: () => m.settings_template_field_title(),
        title_trunc: () => m.settings_template_field_title_trunc(),
        type: () => m.settings_template_field_type(),
        author: () => m.settings_template_field_author(),
        authorid: () => m.settings_template_field_authorid(),
        posted: () => m.settings_template_field_posted(),
        today: () => m.settings_template_field_today(),
        page: () => m.settings_template_field_page(),
        ext: () => m.settings_template_field_ext(),
        home: () => m.settings_template_field_home(),
        root: () => m.settings_template_field_root(),
    };
    return (id: string) => map[id]?.() ?? id;
}

export function useSectionTitle(): (sectionId: string, fallback?: string) => string {
    const m = useMessages();
    const map: Record<string, () => string> = {
        app: () => m.settings_section_app(),
        server: () => m.settings_section_server(),
        log: () => m.settings_section_log(),
        pixiv: () => m.settings_section_pixiv(),
        download: () => m.settings_section_download(),
        inbox: () => m.settings_section_inbox(),
    };
    return (sectionId: string, fallback?: string) => map[sectionId]?.() ?? fallback ?? sectionId;
}

// useFieldEnumLabel renders a friendlier label for select-control enum
// values where the raw code reads poorly (e.g. `app.language`'s
// `en`/`zh-CN`/`ja`/`auto`). Endonyms aren't localized — picking the
// language you read should never depend on the current UI language;
// only "auto" is translated. Most enums (log.level, log.format,
// download.ugoira.format, …) are technical strings and pass through.
export function useFieldEnumLabel(): (field: FieldSpec, value: string) => string {
    const m = useMessages();
    return (field, value) => {
        if (field.key === "app.language") {
            switch (value) {
                case "auto":
                    return m.cfg_app_language_auto();
                case "en":
                    return "English";
                case "zh-CN":
                    return "简体中文";
                case "ja":
                    return "日本語";
            }
        }
        if (field.key === "app.update.channel") {
            switch (value) {
                case "stable":
                    return m.cfg_app_update_channel_stable();
                case "beta":
                    return m.cfg_app_update_channel_beta();
                case "alpha":
                    return m.cfg_app_update_channel_alpha();
            }
        }
        return value;
    };
}

export function useSectionDescription(): (sectionId: string) => string | undefined {
    const m = useMessages();
    const map: Record<string, () => string> = {
        app: () => m.settings_section_app_desc(),
        server: () => m.settings_section_server_desc(),
        log: () => m.settings_section_log_desc(),
        pixiv: () => m.settings_section_pixiv_desc(),
        download: () => m.settings_section_download_desc(),
        inbox: () => m.settings_section_inbox_desc(),
    };
    return (sectionId: string) => map[sectionId]?.();
}
