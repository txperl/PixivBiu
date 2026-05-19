import { HugeiconsIcon } from "@hugeicons/react";
import { type KeyboardEvent, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { CloseIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type TagInputProps = {
    label: string;
    placeholder?: string;
    values: ReadonlyArray<string>;
    onChange: (next: ReadonlyArray<string>) => void;
    className?: string;
};

function TagInput({ label, placeholder, values, onChange, className }: TagInputProps) {
    const [draft, setDraft] = useState("");
    const inputId = useId();

    const add = (raw: string) => {
        const t = raw.trim();
        if (!t) return;
        if (values.includes(t)) {
            setDraft("");
            return;
        }
        onChange([...values, t]);
        setDraft("");
    };

    const remove = (t: string) => {
        onChange(values.filter((x) => x !== t));
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
        } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
        }
    };

    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            <label htmlFor={inputId} className="text-muted-foreground text-xs">
                {label}
            </label>
            <Input
                id={inputId}
                value={draft}
                placeholder={placeholder}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onBlur={() => add(draft)}
                onKeyDown={onKeyDown}
                className="h-8 text-xs"
            />
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {values.map((v) => (
                        <span
                            key={v}
                            className="inline-flex h-6 items-center gap-1 rounded-full bg-secondary px-2 text-secondary-foreground text-xs"
                        >
                            {v}
                            <button
                                type="button"
                                aria-label={`移除 ${v}`}
                                onClick={() => remove(v)}
                                className="-mr-0.5 inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                <HugeiconsIcon icon={CloseIcon} size={10} strokeWidth={2.5} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export default TagInput;
