import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ConfigSource, type FieldSpec, isAdvanced } from "@/features/settings";
import { RefreshIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { fieldId } from "../field-id";
import { FieldControl } from "./controls";

interface SettingsFieldProps {
    field: FieldSpec;
    value: string;
    error?: string;
    source: ConfigSource | undefined;
    // Whether a persisted file-layer override exists (derived from view.file,
    // not `source`, which is stale for pending restart-required keys).
    overridden: boolean;
    pendingRestart: boolean;
    busy: boolean;
    onChange: (value: string) => void;
    onReset: () => void;
}

export function SettingsField({
    field,
    value,
    error,
    source,
    overridden,
    pendingRestart,
    busy,
    onChange,
    onReset,
}: SettingsFieldProps) {
    const id = fieldId(field.key);
    const errorId = `${id}-error`;
    const fromEnv = source === "env";
    // Internal (program-only) keys can only change by editing the config
    // file, so they render read-only just like env-sourced ones.
    const readOnly = fromEnv || field.internal;
    const canReset = overridden && !fromEnv && !field.internal;
    const secretSet = field.sensitive && (overridden || fromEnv);
    // Read-only fields explain where their value actually comes from.
    const readOnlyNote = fromEnv
        ? "由环境变量设置，无法在此修改"
        : field.internal
          ? "运维设置，仅可通过编辑配置文件修改"
          : null;

    return (
        // Advanced / internal fields get a full-bleed muted band so they read
        // as a distinct, lower-priority tier within the otherwise plain list.
        <div className={cn("py-4", isAdvanced(field) && "-mx-[18px] bg-muted/50 px-[18px]")}>
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="font-medium text-foreground text-sm">
                        {field.description || field.key}
                    </label>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <code className="font-mono text-[11px] text-muted-foreground">{field.key}</code>
                        {field.internal && <Badge variant="outline">仅配置文件</Badge>}
                        {field.restartRequired && !field.internal && <Badge variant="outline">需重启</Badge>}
                        {pendingRestart && <Badge className="bg-accent text-accent-foreground">待重启生效</Badge>}
                        {secretSet && <Badge variant="secondary">已设置</Badge>}
                        {fromEnv && <Badge variant="outline">环境变量</Badge>}
                    </div>
                </div>
                {canReset && (
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onReset}>
                        <HugeiconsIcon icon={RefreshIcon} />
                        重置
                    </Button>
                )}
            </div>

            <div className="mt-2.5">
                <FieldControl
                    field={field}
                    id={id}
                    value={value}
                    invalid={!!error}
                    disabled={readOnly}
                    describedBy={error ? errorId : undefined}
                    onChange={onChange}
                />
            </div>

            {error && (
                <p id={errorId} className="mt-1.5 text-destructive text-xs">
                    {error}
                </p>
            )}
            {readOnlyNote && <p className="mt-1.5 text-muted-foreground text-xs">{readOnlyNote}</p>}
        </div>
    );
}
