import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { detectProxies } from "@/features/auth/api";
import { type FieldSpec, useFieldEnumLabel } from "@/features/settings";
import { useMessages } from "@/i18n";
import { MapsSearchIcon } from "@/lib/icons";
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

// SecretControl's reveal state is uncontrolled by default; pass `revealed` +
// `onRevealedChange` to control it (ProxyControl reveals the value after a
// detect so the freshly filled address is visible).
function SecretControl({
    id,
    value,
    invalid,
    disabled,
    describedBy,
    onChange,
    revealed: revealedProp,
    onRevealedChange,
}: ControlProps & { revealed?: boolean; onRevealedChange?: (revealed: boolean) => void }) {
    const m = useMessages();
    const [internalRevealed, setInternalRevealed] = useState(false);
    const revealed = revealedProp ?? internalRevealed;
    const toggle = () => {
        const next = !revealed;
        // Own the state only when uncontrolled; otherwise the parent drives it.
        if (revealedProp === undefined) setInternalRevealed(next);
        onRevealedChange?.(next);
    };
    return (
        <div className="relative max-w-md">
            <Input
                id={id}
                type={revealed ? "text" : "password"}
                value={value}
                disabled={disabled}
                autoComplete="off"
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                placeholder={m.settings_placeholder_secret()}
                className="pr-9"
                onChange={(e) => onChange(e.target.value)}
            />
            {/* Reveal toggle sits inside the input at its right edge; the input's
                pr-9 keeps the value clear of it. */}
            <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={revealed ? m.settings_secret_hide() : m.settings_secret_reveal()}
                className="absolute inset-y-0 right-1 my-auto cursor-pointer text-muted-foreground hover:bg-transparent"
                onClick={toggle}
            >
                <HugeiconsIcon icon={revealed ? ViewOffSlashIcon : ViewIcon} strokeWidth={2} />
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

// Backs the "proxy" control kind (pixiv.proxy): the secret input plus a
// "Detect" button that reads the OS system-proxy configuration (same endpoint
// the login onboarding uses) and fills the address in — so a user behind a GUI
// system proxy needn't type it. Detection is read-only; the value is written
// into the form and applied the normal way (Save → PATCH /config).
function ProxyControl(props: ControlProps) {
    const m = useMessages();
    const { disabled, onChange } = props;
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);

    const onDetect = async () => {
        if (busy || disabled) return;
        setBusy(true);
        setNote(null);
        const { data } = await detectProxies();
        setBusy(false);
        const candidate = data?.candidates?.[0]?.url;
        if (!candidate) {
            setNote(m.settings_proxy_detect_none());
            return;
        }
        onChange(candidate);
        setRevealed(true); // show the freshly detected address rather than dots
        setNote(m.settings_proxy_detect_found({ proxy: candidate }));
    };

    const label = busy ? m.settings_proxy_detecting() : m.settings_proxy_detect();
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
                {/* flex-1 + max-w-md so the secret input keeps its full width
                    (it would otherwise shrink to content as a flex child). */}
                <div className="min-w-0 max-w-md flex-1">
                    <SecretControl {...props} revealed={revealed} onRevealedChange={setRevealed} />
                </div>
                {/* Icon-only, ghost/icon-sm like the reveal toggle, hidden on
                    read-only env/internal fields, sitting just right of the
                    secret input. The tooltip carries the explanation. */}
                {!disabled && (
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={busy}
                                    aria-label={label}
                                    onClick={onDetect}
                                >
                                    <HugeiconsIcon icon={MapsSearchIcon} />
                                </Button>
                            }
                        />
                        <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                )}
            </div>
            {note && <p className="text-muted-foreground text-xs">{note}</p>}
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
        case "proxy":
            return <ProxyControl {...props} />;
        default:
            return <InputControl {...props} />;
    }
}
