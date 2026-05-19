import { Button } from "@/components/ui/button";
import { useGeneralFilters } from "../hooks";
import { isGeneralFiltersDefault } from "../types";

type FilteredEmptyProps = {
    totalBefore: number;
};

function FilteredEmpty({ totalBefore }: FilteredEmptyProps) {
    const { filters, resetFilters } = useGeneralFilters();
    const filtersActive = !isGeneralFiltersDefault(filters);
    return (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
            <div className="font-medium text-foreground">页面筛选剔除了全部 {totalBefore} 项</div>
            {filtersActive && (
                <>
                    <div className="text-muted-foreground text-xs">放宽筛选条件后重试。</div>
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                        清除页面筛选
                    </Button>
                </>
            )}
        </div>
    );
}

export default FilteredEmpty;
