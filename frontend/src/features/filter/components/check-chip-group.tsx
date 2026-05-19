import { cn } from "@/lib/utils";

export type ChipOption<T extends string> = {
    value: T;
    label: string;
};

type CheckChipGroupProps<T extends string> = {
    values: ReadonlyArray<T>;
    options: ReadonlyArray<ChipOption<T>>;
    onChange: (next: ReadonlyArray<T>) => void;
    className?: string;
};

function CheckChipGroup<T extends string>({ values, options, onChange, className }: CheckChipGroupProps<T>) {
    const toggle = (v: T) => {
        const has = values.includes(v);
        onChange(has ? values.filter((x) => x !== v) : [...values, v]);
    };
    return (
        <div className={cn("flex flex-wrap gap-1.5", className)}>
            {options.map((opt) => {
                const active = values.includes(opt.value);
                return (
                    <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(opt.value)}
                        className={cn(
                            "inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors",
                            active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

export default CheckChipGroup;
