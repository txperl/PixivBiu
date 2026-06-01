import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/features/auth/use-auth";
import { useMessages } from "@/i18n";

const AVATAR_GRADIENT = "linear-gradient(135deg, oklch(0.78 0.10 45), oklch(0.68 0.13 45))";

function AccountButton() {
    const m = useMessages();
    const { status, pending, logout } = useAuth();

    // The sidebar is only ever rendered when authenticated (RootLayout guards
    // unauth users to /login), so we only need the loading skeleton and the
    // signed-in view here.
    if (status === null || !status.authenticated) {
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

    const initial = (status.user_name?.trim().slice(0, 1) || "P").toUpperCase();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <button
                        type="button"
                        aria-label={m.auth_account_menu()}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
                    />
                }
            >
                <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm text-white"
                    style={{ background: AVATAR_GRADIENT }}
                >
                    {initial}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground text-sm">{status.user_name ?? "—"}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                        {status.user_id != null ? `#${status.user_id}` : "—"}
                    </div>
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" sideOffset={8}>
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                        void logout();
                    }}
                    disabled={pending}
                >
                    {m.auth_logout()}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default AccountButton;
