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

export interface NamingMenuItem {
    // Label key suffix + React key.
    id: string;
    // Leaf item: the complete token inserted on click.
    insert?: string;
    // Branch item: a submenu of date-format presets (then `insert` is unused).
    presets?: DatePreset[];
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

export const NAMING_MENU: readonly NamingMenuItem[] = [
    { id: "id", insert: "{{.IllustID}}" },
    { id: "title", insert: "{{.Title}}" },
    { id: "title_trunc", insert: "{{.Title | trunc 80}}" },
    { id: "type", insert: "{{.Type}}" },
    { id: "author", insert: "{{.UserName}}" },
    { id: "authorid", insert: "{{.UserID}}" },
    { id: "posted", presets: datePresets(".CreatedAt") },
    { id: "today", presets: datePresets(".Now") },
    { id: "page", insert: "{{.Index | pad 2}}" },
    { id: "ext", insert: "{{.Ext}}" },
    { id: "home", insert: "{{.Home}}" },
    { id: "root", insert: "{{.Root}}" },
] as const;
