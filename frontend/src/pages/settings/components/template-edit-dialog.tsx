import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    type DatePreset,
    type FieldSpec,
    menuForField,
    useFieldText,
    useNamingFieldLabel,
    useTemplatePreview,
} from "@/features/settings";
import { useMessages } from "@/i18n";
import { ChevronDownIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

// A flat "insert" chip for a date field. Because a date has several format
// presets, it carries a chevron and opens a small picker on click rather than
// inserting a token directly.
function DatePresetChip({
    label,
    presets,
    onInsert,
}: {
    label: string;
    presets: readonly DatePreset[];
    onInsert: (snippet: string) => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button type="button" variant="outline" size="sm" className="gap-1">
                        {label}
                        <HugeiconsIcon icon={ChevronDownIcon} className="text-muted-foreground" />
                    </Button>
                }
            />
            <PopoverContent align="start" sideOffset={6} className="w-auto min-w-40 p-1">
                <div className="flex flex-col">
                    {presets.map((preset) => (
                        <Button
                            key={preset.label}
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="justify-start font-mono"
                            onClick={() => {
                                onInsert(preset.insert);
                                setOpen(false);
                            }}
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

const TEXTAREA_CLASS = cn(
    "w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none transition-colors",
    "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
);

interface TemplateEditDialogProps {
    field: FieldSpec;
    id: string;
    value: string;
    invalid: boolean;
    disabled: boolean;
    describedBy?: string;
    onChange: (value: string) => void;
}

// The dialog launched from a template field's "Edit" button. Holds a draft of
// the template; the palette only ever inserts COMPLETE {{...}} tokens, and a
// live preview renders the full example path. "Done" writes the draft back to
// the form (page-level Save still commits); "Cancel"/close discards it.
export function TemplateEditDialog({
    field,
    id,
    value,
    invalid,
    disabled,
    describedBy,
    onChange,
}: TemplateEditDialogProps) {
    const m = useMessages();
    const fieldText = useFieldText();
    const labelOf = useNamingFieldLabel();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(value);
    const ref = useRef<HTMLTextAreaElement>(null);
    const { example, error: previewError } = useTemplatePreview(field.key, draft, open);
    // Only the tokens valid for THIS field — output_dir gets home/root,
    // filenames get ext (and the multi-page one gets page); see menuForField.
    const menu = menuForField(field.key);

    // Re-seed the draft from the committed value each time the dialog opens (so
    // a cancelled edit doesn't linger), and focus the editor with the caret at
    // the end — otherwise an un-focused textarea reports caret 0 and the first
    // insert would prepend instead of append.
    useEffect(() => {
        if (!open) return;
        setDraft(value);
        requestAnimationFrame(() => {
            const ta = ref.current;
            if (!ta) return;
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
        });
    }, [open, value]);

    // Splice a complete token in at the caret (replacing any selection), then
    // restore the caret just after it once React re-renders the controlled value.
    const insert = (snippet: string) => {
        const ta = ref.current;
        if (!ta) {
            setDraft((d) => d + snippet);
            return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        setDraft((d) => d.slice(0, start) + snippet + d.slice(end));
        const caret = start + snippet.length;
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(caret, caret);
        });
    };

    const commit = () => {
        onChange(draft);
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
                render={
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        disabled={disabled}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                    />
                }
            >
                <HugeiconsIcon icon={PencilEdit02Icon} />
                {m.settings_template_edit()}
            </DialogTrigger>

            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{fieldText(field)}</DialogTitle>
                    <DialogDescription className="font-mono text-xs">{field.key}</DialogDescription>
                </DialogHeader>

                <textarea
                    ref={ref}
                    value={draft}
                    rows={3}
                    spellCheck={false}
                    placeholder={field.default != null ? String(field.default) : undefined}
                    className={TEXTAREA_CLASS}
                    onChange={(e) => setDraft(e.target.value)}
                />

                <div className="space-y-1.5">
                    <div className="text-muted-foreground text-xs">{m.settings_template_insert_field()}</div>
                    <div className="flex flex-wrap gap-1.5">
                        {menu.map((item) =>
                            item.presets ? (
                                <DatePresetChip
                                    key={item.id}
                                    label={labelOf(item.id)}
                                    presets={item.presets}
                                    onInsert={insert}
                                />
                            ) : (
                                <Button
                                    key={item.id}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    title={item.insert}
                                    onClick={() => item.insert && insert(item.insert)}
                                >
                                    {labelOf(item.id)}
                                </Button>
                            ),
                        )}
                    </div>
                    <div className="text-muted-foreground text-xs">{m.settings_template_hint()}</div>
                </div>

                <div className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="mb-1 text-muted-foreground text-xs">{m.settings_template_preview()}</div>
                    {previewError ? (
                        <code className="block break-all font-mono text-destructive text-xs">{previewError}</code>
                    ) : (
                        <code className="block break-all font-mono text-foreground text-xs">{example}</code>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mr-auto"
                        onClick={() => setDraft(field.default != null ? String(field.default) : "")}
                    >
                        {m.settings_template_reset_default()}
                    </Button>
                    <DialogClose render={<Button type="button" variant="ghost" size="sm" />}>
                        {m.common_cancel()}
                    </DialogClose>
                    <Button type="button" size="sm" onClick={commit}>
                        {m.settings_template_done()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
