import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import { api, type components } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type AuthStatus = components["schemas"]["AuthStatus"];
type ApiError = components["schemas"]["Error"];

function AuthPanel() {
    const [status, setStatus] = useState<AuthStatus | null>(null);
    const [token, setToken] = useState("");
    const [error, setError] = useState<ApiError | null>(null);
    const [pending, setPending] = useState(false);

    const fetchStatus = useCallback(async () => {
        const { data, error: err } = await api.GET("/auth/status");
        if (err) {
            setError(err);
            return;
        }
        setStatus(data);
        setError(null);
    }, []);

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    const onLogin = async (e: SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        const trimmed = token.trim();
        if (!trimmed) return;
        setPending(true);
        setError(null);
        const { data, error: err } = await api.POST("/auth/login", {
            body: { refresh_token: trimmed },
        });
        setPending(false);
        if (err) {
            setError(err);
            return;
        }
        setStatus(data);
        setToken("");
    };

    const onLogout = async () => {
        setPending(true);
        setError(null);
        const { error: err } = await api.POST("/auth/logout");
        setPending(false);
        if (err) {
            setError(err);
            return;
        }
        await fetchStatus();
    };

    const authed = status?.authenticated ?? false;

    return (
        <section className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
            <header className="mb-4 flex items-center justify-between">
                <h2 className="font-semibold text-lg">Pixiv Auth</h2>
                <span
                    className={cn(
                        "rounded-full px-2 py-0.5 font-medium text-xs",
                        status === null
                            ? "bg-muted text-muted-foreground"
                            : authed
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground",
                    )}
                >
                    {status === null ? "Loading…" : authed ? "Authenticated" : "Unauthenticated"}
                </span>
            </header>

            {authed ? (
                <div className="space-y-3">
                    <dl className="space-y-1 text-sm">
                        <div className="flex justify-between gap-4">
                            <dt className="text-muted-foreground">User</dt>
                            <dd className="truncate">
                                {status?.user_name ?? "—"}
                                {status?.user_id != null && (
                                    <span className="ml-1 text-muted-foreground">#{status.user_id}</span>
                                )}
                            </dd>
                        </div>
                        <div className="flex justify-between gap-4">
                            <dt className="text-muted-foreground">Expires</dt>
                            <dd>{status?.expires_at ? new Date(status.expires_at).toLocaleString() : "—"}</dd>
                        </div>
                    </dl>
                    <Button variant="destructive" onClick={onLogout} disabled={pending} className="w-full">
                        {pending ? "Signing out…" : "Sign out"}
                    </Button>
                </div>
            ) : (
                <form onSubmit={onLogin} className="space-y-3">
                    <label className="block">
                        <span className="mb-1 block text-muted-foreground text-sm">Pixiv refresh token</span>
                        <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="paste your long-lived OAuth refresh token"
                            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                    </label>
                    <Button type="submit" disabled={pending || !token.trim()} className="w-full">
                        {pending ? "Signing in…" : "Sign in"}
                    </Button>
                </form>
            )}

            {error && (
                <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                    <div className="font-medium">{error.code}</div>
                    <div className="text-destructive/90">{error.message}</div>
                    {error.detail && <div className="mt-1 text-destructive/70 text-xs">{error.detail}</div>}
                </div>
            )}
        </section>
    );
}

export default AuthPanel;
