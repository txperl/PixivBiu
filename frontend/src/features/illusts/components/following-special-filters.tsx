import FilterRow from "@/features/filter/components/filter-row";
import Segmented from "@/features/filter/components/segmented";
import type { Restrict } from "@/features/illusts/api";

type Props = {
    restrict: Restrict;
    onRestrictChange: (v: Restrict) => void;
};

function FollowingSpecialFilters({ restrict, onRestrictChange }: Props) {
    return (
        <FilterRow label="关注范围" inactive={restrict === "public"}>
            <Segmented
                value={restrict}
                options={[
                    { value: "public", label: "公开" },
                    { value: "private", label: "悄悄关注" },
                ]}
                onChange={onRestrictChange}
            />
        </FilterRow>
    );
}

export default FollowingSpecialFilters;
