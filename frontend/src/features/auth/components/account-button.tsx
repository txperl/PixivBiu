import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/use-auth";
import { MoreIcon } from "@/lib/icons";
import LoginDialog from "./login-dialog";

const AVATAR_GRADIENT = "linear-gradient(135deg, oklch(0.78 0.10 45), oklch(0.68 0.13 45))";

function AccountButton() {
    const { status, pending, refresh, logout } = useAuth();
    const [loginOpen, setLoginOpen] = useState(false);

    if (status === null) {
        return (
            <div className="flex items-center gap-3" aria-busy="true">
                <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-1">
                    <div className="h-3.5 w-20 animate-pulse rounded bg-muted" />
                    <div className="h-2.5 w-12 animate-pulse rounded bg-muted" />
                </div>
            </div>
        );
    }

    if (!status.authenticated) {
        return (
            <>
                <button
                    type="button"
                    onClick={() => setLoginOpen(true)}
                    className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-sm">
                        ?
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="font-medium text-foreground text-sm">未登录</div>
                        <div className="text-[11px] text-muted-foreground">点击登录 Pixiv 账号</div>
                    </div>
                </button>
                <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
            </>
        );
    }

    const initial = (status.user_name?.trim().slice(0, 1) || "P").toUpperCase();

    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
                <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-full font-medium text-sm text-white"
                    style={{ background: AVATAR_GRADIENT }}
                >
                    {initial}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground text-sm">{status.user_name ?? "—"}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                        {status.user_id != null ? `#${status.user_id}` : "—"}
                    </div>
                </div>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="账户菜单" />}
                >
                    <HugeiconsIcon icon={MoreIcon} size={16} strokeWidth={1.5} className="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" sideOffset={8}>
                    <DropdownMenuItem
                        onClick={() => {
                            void refresh();
                        }}
                        disabled={pending}
                    >
                        刷新状态
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                            void logout();
                        }}
                        disabled={pending}
                    >
                        退出登录
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}

export default AccountButton;
