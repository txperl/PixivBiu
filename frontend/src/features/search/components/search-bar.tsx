import { HugeiconsIcon } from "@hugeicons/react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FilterIcon, GridIcon, SearchIcon } from "@/lib/icons";

type SearchBarProps = {
    defaultValue?: string;
    autoFocus?: boolean;
};

// Submitting always navigates to /search/{keyword}; current search-page query
// keys (type/target/sort) are preserved so users can refine the query in place.
// `page` is intentionally dropped on a new keyword so we restart from page 1.
const PRESERVED_QUERY_KEYS = ["type", "target", "sort"] as const;

function SearchBar({ defaultValue = "", autoFocus = false }: SearchBarProps) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setValue(defaultValue);
    }, [defaultValue]);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    const submit = () => {
        const trimmed = value.trim();
        if (!trimmed) return;
        const next = new URLSearchParams();
        for (const k of PRESERVED_QUERY_KEYS) {
            const v = searchParams.get(k);
            if (v) next.set(k, v);
        }
        const qs = next.toString();
        navigate(`/search/${encodeURIComponent(trimmed)}${qs ? `?${qs}` : ""}`);
    };

    const onSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        submit();
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            submit();
        }
    };

    return (
        <form onSubmit={onSubmit} className="flex items-center gap-1 pt-1">
            <div className="flex h-12 max-w-[560px] flex-1 items-center gap-3 rounded-[28px] bg-muted/60 px-4 transition-colors focus-within:bg-muted hover:bg-muted">
                <button
                    type="submit"
                    aria-label="搜索"
                    className="flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                    <HugeiconsIcon icon={SearchIcon} size={20} strokeWidth={1.5} />
                </button>
                <input
                    ref={inputRef}
                    type="search"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="搜索作品、作者、#标签…"
                    className="h-auto w-full appearance-none bg-transparent outline-none"
                />
                <kbd className="rounded-md bg-card px-2 py-[3px] font-mono text-[11px] text-muted-foreground">⌘K</kbd>
            </div>

            <div className="flex-1" />

            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="筛选"
                            className="size-10 rounded-full"
                        >
                            <HugeiconsIcon icon={FilterIcon} size={18} strokeWidth={1.5} />
                        </Button>
                    }
                />
                <TooltipContent>筛选</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="布局"
                            className="size-10 rounded-full"
                        >
                            <HugeiconsIcon icon={GridIcon} size={18} strokeWidth={1.5} />
                        </Button>
                    }
                />
                <TooltipContent>布局</TooltipContent>
            </Tooltip>
        </form>
    );
}

export default SearchBar;
