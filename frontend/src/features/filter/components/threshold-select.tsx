import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ThresholdSelectProps<T extends number> = {
    value: T;
    options: ReadonlyArray<T>;
    formatOption: (v: T) => string;
    onChange: (v: T) => void;
    className?: string;
};

function ThresholdSelect<T extends number>({
    value,
    options,
    formatOption,
    onChange,
    className,
}: ThresholdSelectProps<T>) {
    const items = options.map((v) => ({ value: String(v), label: formatOption(v), raw: v }));
    return (
        <Select
            items={items}
            value={String(value)}
            onValueChange={(v) => {
                if (typeof v !== "string") return;
                const next = Number(v) as T;
                if ((options as readonly number[]).includes(next)) onChange(next);
            }}
        >
            <SelectTrigger size="sm" className={className ?? "w-full text-xs"}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map((item) => (
                        <SelectItem key={item.value} value={item.value} className="text-xs">
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

export default ThresholdSelect;
