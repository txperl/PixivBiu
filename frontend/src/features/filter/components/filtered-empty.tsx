import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { useGeneralFilters } from "../hooks";
import { isGeneralFiltersDefault } from "../types";

type FilteredEmptyProps = {
    totalBefore: number;
};

function FilteredEmpty({ totalBefore }: FilteredEmptyProps) {
    const m = useMessages();
    const { filters, resetFilters } = useGeneralFilters();
    const filtersActive = !isGeneralFiltersDefault(filters);
    return (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="font-medium text-foreground">{m.filter_empty_all_removed({ count: totalBefore })}</div>
            {filtersActive && (
                <>
                    <div className="text-muted-foreground text-xs">{m.filter_empty_relax()}</div>
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                        {m.filter_empty_clear()}
                    </Button>
                </>
            )}
        </div>
    );
}

export default FilteredEmpty;
