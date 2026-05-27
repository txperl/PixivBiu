import { format, parse, startOfToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMessages } from "@/i18n";

const DATE_FORMAT = "yyyy-MM-dd";

function parseDate(s: string | undefined): Date | undefined {
    if (!s) return undefined;
    const d = parse(s, DATE_FORMAT, new Date());
    return Number.isNaN(d.getTime()) ? undefined : d;
}

type RankingDatePickerProps = {
    date?: string;
    onDateChange: (next: string | undefined) => void;
};

function RankingDatePicker({ date, onDateChange }: RankingDatePickerProps) {
    const m = useMessages();
    const selectedDate = parseDate(date);
    const today = startOfToday();
    const label = date ?? m.common_today();

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <button
                        type="button"
                        aria-label={m.ranking_date_pick_aria({ date: label })}
                        className="-mx-1.5 cursor-pointer rounded px-1.5 py-0.5 text-foreground text-xl underline decoration-1 decoration-foreground/30 decoration-dashed underline-offset-[6px] transition-colors hover:bg-foreground/4 hover:text-foreground/90 hover:decoration-foreground/60 data-popup-open:bg-foreground/4 data-popup-open:text-foreground/90 data-popup-open:decoration-foreground/60"
                    >
                        {label}
                    </button>
                }
            />
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    className="min-w-64"
                    mode="single"
                    selected={selectedDate}
                    defaultMonth={selectedDate ?? today}
                    onSelect={(next) => onDateChange(next ? format(next, DATE_FORMAT) : undefined)}
                    disabled={{ after: today }}
                />
                <div className="flex justify-end border-t px-2.5 py-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!date}
                        onClick={() => onDateChange(undefined)}
                    >
                        {m.common_today()}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default RankingDatePicker;
