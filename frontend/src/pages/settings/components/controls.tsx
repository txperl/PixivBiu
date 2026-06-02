import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type FieldSpec, useFieldEnumLabel } from "@/features/settings";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { TemplateEditDialog } from "./template-edit-dialog";

export interface ControlProps {
    field: FieldSpec;
    id: string;
    value: string;
    invalid: boolean;
    disabled: boolean;
    describedBy?: string;
    onChange: (value: string) => void;
}

// Backs the text, number, and duration kinds — all single-line <Input>s that
// differ only in type, width, and placeholder.
function InputControl({ field, id, value, invalid, disabled, describedBy, onChange }: ControlProps) {
    const m = useMessages();
    const isNumber = field.control === "number";
    const isDuration = field.control === "duration";
    return (
        <Input
            id={id}
            type={isNumber ? "number" : undefined}
            inputMode={isNumber ? "numeric" : undefined}
            value={value}
            min={isNumber ? field.minimum : undefined}
            max={isNumber ? field.maximum : undefined}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder={
                isDuration
                    ? m.settings_placeholder_duration()
                    : field.default != null
                      ? String(field.default)
                      : undefined
            }
            className={cn(isNumber || isDuration ? "max-w-[12rem]" : "max-w-md", isDuration && "font-mono")}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

function SwitchControl({ id, value, disabled, describedBy, onChange }: ControlProps) {
    return (
        <Switch
            id={id}
            checked={value === "true"}
            disabled={disabled}
            aria-describedby={describedBy}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
        />
    );
}

function SelectControl({ field, id, value, invalid, disabled, onChange }: ControlProps) {
    const labelOf = useFieldEnumLabel();
    const items = (field.enum ?? []).map((v) => ({ value: v, label: labelOf(field, v) }));
    return (
        <Select items={items} value={value} disabled={disabled} onValueChange={(v) => onChange(String(v))}>
            <SelectTrigger id={id} aria-invalid={invalid || undefined} className="w-[12rem]">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

function SecretControl({ id, value, invalid, disabled, describedBy, onChange }: ControlProps) {
    const m = useMessages();
    const [revealed, setRevealed] = useState(false);
    return (
        <div className="flex max-w-md items-center gap-1.5">
            <Input
                id={id}
                type={revealed ? "text" : "password"}
                value={value}
                disabled={disabled}
                autoComplete="off"
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                placeholder={m.settings_placeholder_secret()}
                onChange={(e) => onChange(e.target.value)}
            />
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={revealed ? m.settings_secret_hide() : m.settings_secret_reveal()}
                onClick={() => setRevealed((r) => !r)}
            >
                <HugeiconsIcon icon={revealed ? ViewOffSlashIcon : ViewIcon} />
            </Button>
        </div>
    );
}

const TEXTAREA_CLASS = cn(
    "w-full max-w-2xl resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm outline-none transition-colors",
    "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
    "dark:bg-input/30",
);

function TextareaControl({ field, id, value, invalid, disabled, describedBy, onChange }: ControlProps) {
    return (
        <textarea
            id={id}
            value={value}
            disabled={disabled}
            rows={2}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder={field.default != null ? String(field.default) : undefined}
            className={TEXTAREA_CLASS}
            onChange={(e) => onChange(e.target.value)}
        />
    );
}

// Template fields (output_dir / file_template / file_group_template) show the
// current Go text/template in a disabled, monospace input (display only) plus
// an "Edit" button that opens the dedicated dialog editor (semantic token
// palette + live preview). The dialog is the only way to change the value: it
// keeps a draft and writes it back to the form on "Done".
function TemplateControl({ field, id, value, invalid, disabled, describedBy, onChange }: ControlProps) {
    return (
        <div className="flex max-w-2xl items-center gap-2">
            {/* Display-only mirror of the value; the Edit button (below) is the
                focusable control that owns the field id + aria state. */}
            <Input
                value={value}
                disabled
                placeholder={field.default != null ? String(field.default) : undefined}
                className="flex-1 font-mono"
            />
            <TemplateEditDialog
                field={field}
                id={id}
                value={value}
                invalid={invalid}
                disabled={disabled}
                describedBy={describedBy}
                onChange={onChange}
            />
        </div>
    );
}

// Dispatches to the right control for a field. The control kind was decided
// once in compileSchema, so this is a pure switch.
export function FieldControl(props: ControlProps) {
    switch (props.field.control) {
        case "switch":
            return <SwitchControl {...props} />;
        case "select":
            return <SelectControl {...props} />;
        case "password":
            return <SecretControl {...props} />;
        case "textarea":
            return <TextareaControl {...props} />;
        case "template":
            return <TemplateControl {...props} />;
        default:
            return <InputControl {...props} />;
    }
}
