import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import type { UserPreview } from "@/features/search/api";
import IllustPlaceholderArt from "@/features/search/components/illust-placeholder-art";
import FollowButton from "@/features/users/components/follow-button";
import { hueFromId } from "@/lib/format";

type UserCardProps = {
    preview: UserPreview;
};

function UserCard({ preview }: UserCardProps) {
    const { user, illusts } = preview;
    const thumbs = illusts.slice(0, 3);

    return (
        <div className="rounded-2xl bg-card p-4 transition-colors hover:bg-muted/40">
            <div className="flex items-center gap-3">
                <PximgImage
                    src={user.profile_image_urls.medium}
                    alt={user.name}
                    fallback={<Avatar hue={hueFromId(user.id)} initial={user.name[0] ?? "?"} size={48} />}
                    className="size-12 shrink-0 rounded-full object-cover ring-2 ring-white/80"
                />
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground text-sm" title={user.name}>
                        {user.name}
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground" title={user.account}>
                        @{user.account}
                    </div>
                </div>
                <FollowButton userId={user.id} isFollowed={user.is_followed} />
            </div>

            {thumbs.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                    {thumbs.map((il) => (
                        <PximgImage
                            key={il.id}
                            src={il.image_urls.square_medium}
                            alt={il.title}
                            fallback={<IllustPlaceholderArt hue={hueFromId(il.id)} ratio="1/1" rounded={8} />}
                            className="aspect-square w-full rounded-lg object-cover"
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default UserCard;
