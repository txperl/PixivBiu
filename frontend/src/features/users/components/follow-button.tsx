import { useState } from "react";
import { addFollow, deleteFollow } from "@/features/users/api";
import { cn } from "@/lib/utils";

type FollowButtonProps = {
    userId: number;
    initialIsFollowed: boolean | null;
    className?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
    unauthenticated: "请先登录 Pixiv 账号",
    rate_limited: "请求过于频繁，请稍后再试",
};

function FollowButton({ userId, initialIsFollowed, className }: FollowButtonProps) {
    const [followed, setFollowed] = useState(initialIsFollowed);
    const [pending, setPending] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);

    // null means Pixiv didn't tell us (e.g., the viewer is the user themselves);
    // disable the action rather than guess.
    if (followed === null) {
        return (
            <span
                className={cn(
                    "shrink-0 select-none rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground/70",
                    className,
                )}
            >
                —
            </span>
        );
    }

    const onClick = async () => {
        if (pending) return;
        const next = !followed;
        setFollowed(next);
        setPending(true);
        setErrorTitle(null);
        const { error } = next ? await addFollow(userId) : await deleteFollow(userId);
        if (error) {
            setFollowed(!next);
            setErrorTitle(ERROR_MESSAGES[error.code] ?? error.message);
        }
        setPending(false);
    };

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={pending}
            title={errorTitle ?? undefined}
            aria-pressed={followed}
            className={cn(
                "group/follow shrink-0 cursor-pointer select-none rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:cursor-wait disabled:opacity-60",
                followed
                    ? "bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive"
                    : "border border-border text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
                errorTitle && "ring-1 ring-destructive/40",
                className,
            )}
        >
            {followed ? (
                <>
                    <span className="group-hover/follow:hidden">已关注</span>
                    <span className="hidden group-hover/follow:inline">取消关注</span>
                </>
            ) : (
                "+ 关注"
            )}
        </button>
    );
}

export default FollowButton;
