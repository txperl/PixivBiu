import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type NamingPreviewRequest, type NamingPreviewResponse, previewNaming } from "./api";
import type { FormValues } from "./values";

// The three dotted config keys the template editor covers.
const OUTPUT_DIR_KEY = "download.output_dir";
const FILE_KEY = "download.file_template";
const GROUP_KEY = "download.file_group_template";

// Live values mirror the preview request body; tying the type to the generated
// request keeps them in lockstep if the schema gains a field.
export type NamingValues = Required<NamingPreviewRequest>;

const EMPTY_VALUES: NamingValues = { output_dir: "", file_template: "", file_group_template: "" };

// Single source of truth per editable template field: which request-body field
// the draft overlays, and which response slice is its full-path example. Both
// the request build and the result read go through this, so the field↔slot
// correspondence is defined once.
const FIELD_MAP: Record<string, { body: keyof NamingValues; slice: (r: NamingPreviewResponse) => string }> = {
    [OUTPUT_DIR_KEY]: { body: "output_dir", slice: (r) => r.output_dir },
    [FILE_KEY]: { body: "file_template", slice: (r) => r.single_page },
    [GROUP_KEY]: { body: "file_group_template", slice: (r) => r.multi_page },
};

const NamingValuesContext = createContext<NamingValues | null>(null);

// Exposes the three live (unsaved) template values to the per-field edit
// dialogs. A dialog editing one template still needs the other two to render
// the full-path preview — this hands them over without prop-drilling through
// the section / field components.
export function NamingValuesProvider({ values, children }: { values: FormValues; children: ReactNode }) {
    const outputDir = values[OUTPUT_DIR_KEY] ?? "";
    const fileTemplate = values[FILE_KEY] ?? "";
    const fileGroupTemplate = values[GROUP_KEY] ?? "";
    const v = useMemo<NamingValues>(
        () => ({ output_dir: outputDir, file_template: fileTemplate, file_group_template: fileGroupTemplate }),
        [outputDir, fileTemplate, fileGroupTemplate],
    );
    return <NamingValuesContext.Provider value={v}>{children}</NamingValuesContext.Provider>;
}

export function useNamingValues(): NamingValues {
    return useContext(NamingValuesContext) ?? EMPTY_VALUES;
}

export interface FieldPreview {
    // Rendered full-path example (empty until the first response, or when this
    // template failed to render).
    example: string;
    // Per-template parse/exec error from the backend, if any. Raw text from
    // the Go template engine — useful detail for a power-user editor.
    error?: string;
}

const EMPTY_PREVIEW: FieldPreview = { example: "" };

const DEBOUNCE_MS = 300;

// Debounced live preview for the ONE template being edited in a dialog.
// `draft` is the in-progress value for `fieldKey`; the other two templates come
// from the committed form values (useNamingValues). Only fires while `active`
// (the dialog is open), with an out-of-order-response guard.
export function useTemplatePreview(fieldKey: string, draft: string, active: boolean): FieldPreview {
    const siblings = useNamingValues();
    const [resp, setResp] = useState<NamingPreviewResponse | null>(null);
    const seqRef = useRef(0);
    const lastFetched = useRef<string | null>(null);

    // All three committed values, with the edited field overridden by the draft.
    const body = useMemo<NamingValues>(() => {
        const entry = FIELD_MAP[fieldKey];
        return entry ? { ...siblings, [entry.body]: draft } : siblings;
    }, [siblings, fieldKey, draft]);

    useEffect(() => {
        if (!active) return;
        // Reopening an unedited dialog yields a body identical to the last
        // fetch — skip the redundant request and keep the current result.
        const sig = JSON.stringify(body);
        if (sig === lastFetched.current) return;
        const handle = setTimeout(() => {
            const seq = ++seqRef.current;
            void previewNaming(body).then(({ data }) => {
                if (seq === seqRef.current && data) {
                    lastFetched.current = sig;
                    setResp(data);
                }
            });
        }, DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [active, body]);

    if (!resp) return EMPTY_PREVIEW;
    const entry = FIELD_MAP[fieldKey];
    return { example: entry ? entry.slice(resp) : "", error: resp.fields?.[fieldKey] || undefined };
}
