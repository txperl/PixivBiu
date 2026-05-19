import { cn } from "@/lib/utils";

type Props = {
    label: string;
    children: React.ReactNode;
    inactive?: boolean;
};

function FilterRow({ label, children, inactive = false }: Props) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground text-xs">{label}</div>
            <div className={cn("flex flex-col gap-1.5 transition-opacity duration-150", inactive && "opacity-50")}>
                {children}
            </div>
        </div>
    );
}

export default FilterRow;
