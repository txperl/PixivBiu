import { Skeleton } from "@/components/ui/skeleton";
import type { UserPreview } from "@/features/search/api";
import UserCard from "./user-card";

type UserListProps = {
    previews: UserPreview[];
};

function UserList({ previews }: UserListProps) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {previews.map((p) => (
                <UserCard key={p.user.id} preview={p} />
            ))}
        </div>
    );
}

export function UserListSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                <div key={i} className="rounded-2xl bg-card p-4">
                    <div className="flex items-center gap-3">
                        <Skeleton className="size-12 shrink-0 rounded-full" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-3 w-1/3" />
                        </div>
                        <Skeleton className="h-[26px] w-16 shrink-0 rounded-full" />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                        <Skeleton className="aspect-square w-full rounded-lg" />
                        <Skeleton className="aspect-square w-full rounded-lg" />
                        <Skeleton className="aspect-square w-full rounded-lg" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default UserList;
