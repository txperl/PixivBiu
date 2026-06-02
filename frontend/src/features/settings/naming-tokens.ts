// Semantic "insert field" menu for the template-editor dialog. Every entry
// produces a COMPLETE, valid {{...}} token — we never insert a bare function
// fragment (e.g. " | trunc 80"), which is only meaningful inside a pipe and
// just produced garbage when inserted outside braces.
//
// Mirrors internal/download/naming.go: the NameContext variables plus the
// funcMap transforms, pre-composed into ready-to-use fields. `id` is the i18n
// label key suffix (settings_template_field_<id>); the token itself is shown
// as secondary text in the menu, so it needs no translation.

export interface DatePreset {
    // Sample-date label shown verbatim (locale-independent), e.g. "2026-06-02".
    label: string;
    // Complete token, e.g. `{{.CreatedAt | date "2006-01-02"}}`.
    insert: string;
}

// The three dotted config keys the template editor covers. Defined here (the
// palette-data module) so both the palette scoping and the preview context
// share one source of truth.
export const OUTPUT_DIR_KEY = "download.output_dir";
export const FILE_KEY = "download.file_template";
export const GROUP_KEY = "download.file_group_template";

export interface NamingMenuItem {
    // Label key suffix + React key.
    id: string;
    // Leaf item: the complete token inserted on click.
    insert?: string;
    // Branch item: a submenu of date-format presets (then `insert` is unused).
    presets?: DatePreset[];
    // Field keys this token is offered for; absent ⇒ shown for every field.
    // The three fields render differently — output_dir is a directory anchor
    // (RenderRootPath, absolute-aware) while file/group are ALWAYS-relative
    // filename paths (RenderRelativePath strips a leading slash) — so a token
    // valid in one is nonsense in another.
    fields?: readonly string[];
}

// Go reference-time layouts → friendly sample labels. Shared by the "posted"
// and "current" date fields; each binds the layouts to its own variable.
function datePresets(variable: string): DatePreset[] {
    return [
        { label: "2026-06-02", insert: `{{${variable} | date "2006-01-02"}}` },
        { label: "2026/06", insert: `{{${variable} | date "2006/01"}}` },
        { label: "20260602", insert: `{{${variable} | date "20060102"}}` },
        { label: "2026", insert: `{{${variable} | date "2006"}}` },
    ];
}

// Grouped so the palette reads in tidy bands: work metadata, then author, then
// dates, then the field-scoped location/structure tokens. The first three
// bands show for every field; the last band is filtered per field (see below).
export const NAMING_MENU: readonly NamingMenuItem[] = [
    // Work metadata.
    { id: "id", insert: "{{.IllustID}}" },
    { id: "type", insert: "{{.Type}}" },
    { id: "title", insert: "{{.Title}}" },
    { id: "title_trunc", insert: "{{.Title | trunc 80}}" },
    // Author.
    { id: "author", insert: "{{.UserName}}" },
    { id: "authorid", insert: "{{.UserID}}" },
    // Dates.
    { id: "posted", presets: datePresets(".CreatedAt") },
    { id: "today", presets: datePresets(".Now") },
    // Location / structure — field-scoped and mutually exclusive: home/root
    // anchor the directory and are stripped to relative inside a filename; page
    // only matters for the multi-page filename (single-page and the directory
    // both render at Index 0); ext belongs to a filename, not a directory.
    { id: "home", insert: "{{.Home}}", fields: [OUTPUT_DIR_KEY] },
    { id: "root", insert: "{{.Root}}", fields: [OUTPUT_DIR_KEY] },
    { id: "page", insert: "{{.Index | pad 2}}", fields: [GROUP_KEY] },
    { id: "ext", insert: "{{.Ext}}", fields: [FILE_KEY, GROUP_KEY] },
] as const;

// menuForField returns the palette entries valid for one template field (see
// NamingMenuItem.fields). The dialog renders this rather than the full menu so
// it never offers a token that is meaningless — or actively misleading — for
// the field being edited.
export function menuForField(fieldKey: string): readonly NamingMenuItem[] {
    return NAMING_MENU.filter((item) => !item.fields || item.fields.includes(fieldKey));
}
