import { type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AuthApiError } from "@/features/auth/api";
import { useAuth } from "@/features/auth/use-auth";

interface LoginDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type Step = "start" | "paste";
type OAuthSession = { state: string; loginUrl: string };

const POPUP_FEATURES = "popup,width=480,height=720";
const POPUP_NAME = "pixivLogin";

function openPixivPopup(url: string) {
    return window.open(url, POPUP_NAME, POPUP_FEATURES);
}

// detectPasteIssue returns a friendly hint for inputs that look like they're
// going to fail before we even round-trip the server — e.g. the user pasted
// the Pixiv intermediate page URL (which has no `code=`) instead of the
// callback URL. Returns null when the value looks plausible.
function detectPasteIssue(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/[?&]code=/.test(trimmed)) return null;
    let url: URL | null = null;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.hostname === "accounts.pixiv.net") {
        return "这是 Pixiv 登录中转页的链接，里面没有 code。请去 DevTools › Network 找一条 URL 形如 “…/auth/pixiv/callback?code=…” 的请求。";
    }
    if (url.hostname.endsWith("pixiv.net")) {
        return "这个 pixiv 链接里没有 code= 参数。要复制的是 Network 面板里 “callback?code=…” 那一行。";
    }
    return "这个链接里没有 code= 参数。请确认从 DevTools › Network 复制的是 “callback?code=…” 那条请求的 URL。";
}

function LoginDialog({ open, onOpenChange }: LoginDialogProps) {
    const { login, startOAuth, exchangeOAuth, pending } = useAuth();
    const [step, setStep] = useState<Step>("start");
    const [refreshTokenInput, setRefreshTokenInput] = useState("");
    const [pastedCode, setPastedCode] = useState("");
    const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
    const [error, setError] = useState<AuthApiError | null>(null);
    // Hold the popup so a re-open call can focus() instead of spawning a
    // second window when the same name is requested.
    const popupRef = useRef<Window | null>(null);

    const resetOAuthFlow = useCallback(() => {
        setPastedCode("");
        setOauthSession(null);
        setError(null);
    }, []);

    // Reset on open (not on close): the dialog has a ~100ms close animation,
    // and clearing `step` while `open` flips to false makes the start view
    // flash through the closing dialog.
    useEffect(() => {
        if (open) {
            setStep("start");
            setRefreshTokenInput("");
            resetOAuthFlow();
            popupRef.current = null;
        }
    }, [open, resetOAuthFlow]);

    const pasteHint = useMemo(() => detectPasteIssue(pastedCode), [pastedCode]);

    const onClickPixivLogin = async () => {
        setError(null);
        // Open the popup synchronously to preserve the user-gesture context;
        // browsers block window.open() once it's reached through an awaited
        // call. Navigate it to the real URL after the server responds.
        const popup = openPixivPopup("about:blank");
        popupRef.current = popup;

        const { data, error: err } = await startOAuth();
        if (err || !data) {
            popup?.close();
            popupRef.current = null;
            setError(err ?? { code: "internal_error", message: "Failed to start OAuth" });
            return;
        }
        setOauthSession({ state: data.state, loginUrl: data.login_url });
        if (popup && !popup.closed) {
            popup.location.replace(data.login_url);
        } else {
            popupRef.current = openPixivPopup(data.login_url);
        }
        setStep("paste");
    };

    const onReopenPopup = () => {
        if (!oauthSession) return;
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.focus();
            return;
        }
        popupRef.current = openPixivPopup(oauthSession.loginUrl);
    };

    const onSubmitPasted = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
        e.preventDefault();
        if (!oauthSession) return;
        setError(null);
        const err = await exchangeOAuth(oauthSession.state, pastedCode);
        if (err) {
            setError(err);
            return;
        }
        onOpenChange(false);
    };

    const onSubmitRefreshToken = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
        e.preventDefault();
        setError(null);
        const err = await login(refreshTokenInput);
        if (err) {
            setError(err);
            return;
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{step === "start" ? "👋 你好呀，欢迎来到 PixivBiu" : "登录 Pixiv 账号"}</DialogTitle>
                    <DialogDescription>
                        {step === "start"
                            ? "开始的开始，要先登录你的 Pixiv 账号哦"
                            : "请按下面几步操作，注意要在弹出的 Pixiv 登录弹窗中完成。"}
                    </DialogDescription>
                </DialogHeader>

                {step === "start" ? (
                    <StartView
                        pending={pending}
                        error={error}
                        refreshTokenInput={refreshTokenInput}
                        onRefreshTokenChange={setRefreshTokenInput}
                        onSubmitRefreshToken={onSubmitRefreshToken}
                        onClickPixivLogin={onClickPixivLogin}
                    />
                ) : (
                    <PasteView
                        pending={pending}
                        error={error}
                        pasteHint={pasteHint}
                        pastedCode={pastedCode}
                        onPastedCodeChange={setPastedCode}
                        onReopenPopup={onReopenPopup}
                        onBack={() => {
                            setStep("start");
                            resetOAuthFlow();
                        }}
                        onSubmit={onSubmitPasted}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function StartView({
    pending,
    error,
    refreshTokenInput,
    onRefreshTokenChange,
    onSubmitRefreshToken,
    onClickPixivLogin,
}: {
    pending: boolean;
    error: AuthApiError | null;
    refreshTokenInput: string;
    onRefreshTokenChange: (v: string) => void;
    onSubmitRefreshToken: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
    onClickPixivLogin: () => void;
}) {
    return (
        <div className="space-y-3">
            <Button type="button" className="w-full" onClick={onClickPixivLogin} disabled={pending}>
                {pending ? "正在准备…" : "使用 Pixiv 账号登录"}
            </Button>

            {error && <ErrorBlock error={error} />}

            <details className="group rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <summary className="flex cursor-pointer select-none items-center justify-between text-muted-foreground">
                    <span>已经有 Refresh Token？</span>
                    <span className="text-xs opacity-60 group-open:hidden">展开</span>
                    <span className="hidden text-xs opacity-60 group-open:block">收起</span>
                </summary>
                <form onSubmit={onSubmitRefreshToken} className="mt-3 space-y-3">
                    <Input
                        id="login-refresh-token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={refreshTokenInput}
                        onChange={(e) => onRefreshTokenChange(e.target.value)}
                        placeholder="Paste your long-lived OAuth refresh token"
                    />
                    <div className="flex justify-end">
                        <Button type="submit" size="sm" disabled={pending || !refreshTokenInput.trim()}>
                            {pending ? "登录中…" : "用 Refresh Token 登录"}
                        </Button>
                    </div>
                </form>
            </details>
        </div>
    );
}

function PasteView({
    pending,
    error,
    pasteHint,
    pastedCode,
    onPastedCodeChange,
    onReopenPopup,
    onBack,
    onSubmit,
}: {
    pending: boolean;
    error: AuthApiError | null;
    pasteHint: string | null;
    pastedCode: string;
    onPastedCodeChange: (v: string) => void;
    onReopenPopup: () => void;
    onBack: () => void;
    onSubmit: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
}) {
    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <PopupSteps />

            <div>
                <label htmlFor="login-callback-url" className="mb-1 block text-muted-foreground text-xs">
                    复制的链接
                </label>
                <Input
                    id="login-callback-url"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    value={pastedCode}
                    onChange={(e) => onPastedCodeChange(e.target.value)}
                    placeholder="https://..."
                />
                {pasteHint && (
                    <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-700 text-xs dark:text-amber-300">
                        {pasteHint}
                    </p>
                )}
            </div>

            {error && <ErrorBlock error={error} />}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={onReopenPopup} disabled={pending}>
                    重新打开弹窗
                </Button>
                <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
                        返回
                    </Button>
                    <Button type="submit" disabled={pending || !pastedCode.trim()}>
                        {pending ? "登录中…" : "完成登录"}
                    </Button>
                </div>
            </div>
        </form>
    );
}

// Inline JSX for the Network-row mock (rather than a screenshot) so it themes
// with dark/light mode and stays sharp at any zoom.
function PopupSteps() {
    return (
        <ol className="space-y-2.5 text-muted-foreground text-sm">
            <li className="flex items-start gap-2.5">
                <StepBadge n={1} />
                <span>
                    在<Strong>弹窗</Strong>里打开 Dev Tools，按 <Kbd>F12</Kbd> / <Kbd>⌘ ⌥ I</Kbd>
                </span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={2} />
                <span>
                    切到 <Strong>Network</Strong> 面板，勾上 <Strong>Preserve log / 持续记录</Strong>
                </span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={3} />
                <span>
                    在 Network 顶部的 <Strong>Filter 输入框</Strong> 输入 <Kbd>callback?</Kbd>
                </span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={4} />
                <span>登录你的 Pixiv 账号</span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={5} />
                <div className="min-w-0 flex-1 space-y-2">
                    <div>
                        找到下面的请求，右键 → <Code>Copy / 复制</Code> → <Code>Copy URL / 复制链接</Code>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-md bg-background px-2.5 py-2 font-mono text-xs ring-1 ring-border">
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
                            302
                        </span>
                        <span className="min-w-0 truncate">
                            <span className="text-muted-foreground">callback?state=…&amp;code=</span>
                            <span className="font-semibold text-foreground">…</span>
                        </span>
                        <span className="ml-auto shrink-0 truncate text-muted-foreground/80">app-api.pixiv.net</span>
                    </div>
                </div>
            </li>
        </ol>
    );
}

function ErrorBlock({ error }: { error: AuthApiError }) {
    return (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            <div className="font-medium">{error.code}</div>
            <div className="text-destructive/90">{error.message}</div>
            {error.detail && <div className="mt-1 break-all text-destructive/70 text-xs">{error.detail}</div>}
        </div>
    );
}

function StepBadge({ n }: { n: number }) {
    return (
        <span className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary text-xs">
            {n}
        </span>
    );
}

function Kbd({ children }: { children: ReactNode }) {
    return (
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-foreground text-xs">
            {children}
        </kbd>
    );
}

function Strong({ children }: { children: ReactNode }) {
    return <span className="font-medium text-foreground">{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs">{children}</code>;
}

export default LoginDialog;
