import FilterRow from "@/features/filter/components/filter-row";
import Segmented from "@/features/filter/components/segmented";
import type { Restrict } from "@/features/illusts/api";
import { useMessages } from "@/i18n";

type Props = {
    restrict: Restrict;
    onRestrictChange: (v: Restrict) => void;
};

function FollowingSpecialFilters({ restrict, onRestrictChange }: Props) {
    const m = useMessages();
    return (
        <FilterRow label={m.filter_following_scope_label()} inactive={restrict === "public"}>
            <Segmented
                value={restrict}
                options={[
                    { value: "public", label: m.filter_following_scope_public() },
                    { value: "private", label: m.filter_following_scope_private() },
                ]}
                onChange={onRestrictChange}
            />
        </FilterRow>
    );
}

export default FollowingSpecialFilters;
