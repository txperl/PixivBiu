import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { FilterIcon, GridIcon, SearchIcon } from "@/lib/icons";

type SearchBarProps = {
    selectedCount: number;
    onClearSelection: () => void;
};

function SearchBar({ selectedCount, onClearSelection }: SearchBarProps) {
    useEffect(() => {
        console.log(selectedCount, onClearSelection);
    }, [selectedCount, onClearSelection]);

    return (
        <div className="flex items-center gap-1 pt-1">
            <div className="flex h-12 max-w-[560px] flex-1 items-center gap-3 rounded-[28px] bg-muted/60 px-4 transition-colors hover:bg-muted">
                <HugeiconsIcon icon={SearchIcon} size={20} strokeWidth={1.5} className="text-muted-foreground" />
                <input
                    type="search"
                    placeholder="搜索作品、作者、#标签…"
                    className="h-auto w-full appearance-none outline-none"
                />
                <kbd className="rounded-md bg-card px-2 py-[3px] font-mono text-[11px] text-muted-foreground">⌘K</kbd>
            </div>

            <div className="flex-1" />

            <Button variant="ghost" size="icon" title="筛选" className="size-10 rounded-full">
                <HugeiconsIcon icon={FilterIcon} size={18} strokeWidth={1.5} />
            </Button>
            <Button variant="ghost" size="icon" title="布局" className="size-10 rounded-full">
                <HugeiconsIcon icon={GridIcon} size={18} strokeWidth={1.5} />
            </Button>
        </div>
    );
}

export default SearchBar;
