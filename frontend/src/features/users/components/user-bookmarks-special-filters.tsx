import { type KeyboardEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import FilterRow from "@/features/filter/components/filter-row";

type Props = {
    tag: string;
    onTagChange: (v: string) => void;
};

function UserBookmarksSpecialFilters({ tag, onTagChange }: Props) {
    const [draft, setDraft] = useState(tag);
    useEffect(() => setDraft(tag), [tag]);

    const commit = () => {
        const t = draft.trim();
        if (t === tag) return;
        onTagChange(t);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commit();
        } else if (e.key === "Escape") {
            setDraft(tag);
        }
    };

    return (
        <FilterRow label="收藏标签" inactive={tag === ""}>
            <Input
                value={draft}
                placeholder="留空 = 所有标签"
                onChange={(e) => setDraft(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={onKeyDown}
                className="h-8 text-xs"
            />
            <div className="text-muted-foreground text-xs leading-relaxed">
                仅显示带有该收藏标签的作品。按 Enter 应用。
            </div>
        </FilterRow>
    );
}

export default UserBookmarksSpecialFilters;
