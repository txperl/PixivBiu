import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";

// Shown instead of a list's "no results" state when a page past the first comes back empty
// with no continuation: the list exists, this page is just past its end.
function PageBeyondEnd({ target, onJump }: { target: number; onJump: (page: number) => void }) {
    const m = useMessages();
    return (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
            <div className="font-medium text-foreground text-lg">{m.common_page_beyond_end()}</div>
            <Button type="button" variant="outline" size="sm" onClick={() => onJump(target)}>
                {target <= 1 ? m.common_back_to_first_page() : m.common_back_to_page({ page: target })}
            </Button>
        </div>
    );
}

export default PageBeyondEnd;
