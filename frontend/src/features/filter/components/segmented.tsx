import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
    value: T;
    label: string;
};

type SegmentedProps<T extends string> = {
    value: T;
    options: ReadonlyArray<SegmentedOption<T>>;
    onChange: (v: T) => void;
    className?: string;
};

function Segmented<T extends string>({ value, options, onChange, className }: SegmentedProps<T>) {
    return (
        <div className={cn("inline-flex h-7 rounded-md border border-input bg-background p-0.5", className)}>
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            "inline-flex flex-1 items-center justify-center rounded px-2 text-xs transition-colors",
                            active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

export default Segmented;
