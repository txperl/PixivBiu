import Segmented from "@/features/filter/components/segmented";
import type { Restrict } from "@/features/illusts/api";

type Props = {
    restrict: Restrict;
    onRestrictChange: (v: Restrict) => void;
};

function FollowingSpecialFilters({ restrict, onRestrictChange }: Props) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground text-xs">关注范围</div>
            <Segmented
                value={restrict}
                options={[
                    { value: "public", label: "公开" },
                    { value: "private", label: "悄悄关注" },
                ]}
                onChange={onRestrictChange}
            />
        </div>
    );
}

export default FollowingSpecialFilters;
