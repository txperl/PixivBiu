import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AuthApiError } from "@/features/auth/api";
import { useAuth } from "@/features/auth/use-auth";

interface LoginDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
    const { login, pending } = useAuth();
    const [token, setToken] = useState("");
    const [error, setError] = useState<AuthApiError | null>(null);

    useEffect(() => {
        if (!open) {
            setToken("");
            setError(null);
        }
    }, [open]);

    const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const err = await login(token);
        if (err) {
            setError(err);
            return;
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>登录 Pixiv 账号</DialogTitle>
                    <DialogDescription>
                        粘贴长效 OAuth refresh token 完成登录，token 仅在服务端持久化。
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={onSubmit} className="space-y-3">
                    <div>
                        <label htmlFor="login-refresh-token" className="mb-1 block text-muted-foreground text-sm">
                            Refresh token
                        </label>
                        <Input
                            id="login-refresh-token"
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="paste your long-lived OAuth refresh token"
                        />
                    </div>
                    {error && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                            <div className="font-medium">{error.code}</div>
                            <div className="text-destructive/90">{error.message}</div>
                            {error.detail && <div className="mt-1 text-destructive/70 text-xs">{error.detail}</div>}
                        </div>
                    )}
                    <div className="mt-1 flex justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                            取消
                        </Button>
                        <Button type="submit" disabled={pending || !token.trim()}>
                            {pending ? "登录中…" : "登录"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export default LoginDialog;
