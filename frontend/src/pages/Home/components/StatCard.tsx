import { cn } from "@/lib/utils";

type StatCardProps = {
    label: string;
    value: string;
    delta: string;
    mono?: boolean;
    accent?: boolean;
};

function StatCard({ label, value, delta, mono, accent }: StatCardProps) {
    return (
        <div className={cn("rounded-2xl px-[18px] py-4", accent ? "bg-primary text-primary-foreground" : "bg-card")}>
            <div className={cn("font-medium text-xs", accent ? "text-primary-foreground/90" : "text-muted-foreground")}>
                {label}
            </div>
            <div
                className={cn(
                    "mt-1 font-normal text-3xl leading-tight",
                    mono && "font-mono",
                    accent ? "text-primary-foreground" : "text-foreground",
                )}
            >
                {value}
            </div>
            <div
                className={cn(
                    "mt-1 text-xs",
                    (mono || accent) && "font-mono",
                    accent ? "text-primary-foreground/85" : "text-muted-foreground",
                )}
            >
                {delta}
            </div>
        </div>
    );
}

export default StatCard;
