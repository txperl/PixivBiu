import { type KeyboardEvent, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import FilterRow from "@/features/filter/components/filter-row";
import { useMessages } from "@/i18n";

type Props = {
    tag: string;
    onTagChange: (v: string) => void;
};

function UserBookmarksSpecialFilters({ tag, onTagChange }: Props) {
    const m = useMessages();
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
        <FilterRow label={m.filter_user_bookmarks_tag_label()} inactive={tag === ""}>
            <Input
                value={draft}
                placeholder={m.filter_user_bookmarks_tag_placeholder()}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onBlur={commit}
                onKeyDown={onKeyDown}
                className="h-8 text-xs"
            />
            <div className="text-muted-foreground text-xs leading-relaxed">{m.filter_user_bookmarks_tag_hint()}</div>
        </FilterRow>
    );
}

export default UserBookmarksSpecialFilters;
