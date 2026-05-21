import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, type SyntheticEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AuthApiError } from "@/features/auth/api";
import { PasteIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { ErrorBlock } from "./error-block";
import { useReveal } from "./use-reveal";

export function LoginPanel({
    pastedCode,
    onPastedCodeChange,
    pasteHint,
    pending,
    error,
    onPasteFromClipboard,
    onReopenPopup,
    onSubmit,
    refreshTokenInput,
    onRefreshTokenChange,
    onSubmitRefreshToken,
}: {
    pastedCode: string;
    onPastedCodeChange: (v: string) => void;
    pasteHint: string | null;
    pending: boolean;
    error: AuthApiError | null;
    onPasteFromClipboard: () => void;
    onReopenPopup: () => void;
    onSubmit: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
    refreshTokenInput: string;
    onRefreshTokenChange: (v: string) => void;
    onSubmitRefreshToken: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
}) {
    const titleRef = useReveal<HTMLHeadingElement>(200);
    const subtitleRef = useReveal<HTMLParagraphElement>(300);
    const formRef = useReveal<HTMLFormElement>(450);

    return (
        <>
            <div className="space-y-1">
                <h1 ref={titleRef} className="font-heading font-normal text-2xl text-foreground leading-tight">
                    首先，请登录你的 Pixiv 账号
                </h1>
                <p ref={subtitleRef} className="max-w-lg text-muted-foreground">
                    请按下面几步操作，注意要在弹出的 Pixiv 登录弹窗中完成
                </p>
            </div>

            <form ref={formRef} onSubmit={onSubmit} className="mt-10 space-y-3.5">
                <PopupSteps />

                <div>
                    <label htmlFor="login-callback-url" className="mb-1 block text-muted-foreground text-xs">
                        输入复制的链接
                    </label>
                    <div className="relative">
                        <Input
                            id="login-callback-url"
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                            value={pastedCode}
                            onChange={(e) => onPastedCodeChange(e.target.value)}
                            placeholder="https://…"
                            className="pr-8 text-xs"
                        />
                        <Tooltip>
                            <TooltipTrigger
                                delay={50}
                                render={
                                    <button
                                        type="button"
                                        onClick={onPasteFromClipboard}
                                        disabled={pending}
                                        aria-label="从剪贴板粘贴"
                                        className="absolute inset-y-1 right-1 flex items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                    >
                                        <HugeiconsIcon icon={PasteIcon} size={14} strokeWidth={2} />
                                    </button>
                                }
                            />
                            <TooltipContent>从剪贴板粘贴</TooltipContent>
                        </Tooltip>
                    </div>
                    {pasteHint && (
                        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-700 text-xs dark:text-amber-300">
                            {pasteHint}
                        </p>
                    )}
                </div>

                {error && <ErrorBlock error={error} />}

                <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button type="submit" disabled={pending || !pastedCode.trim()}>
                        {pending ? "登录中…" : "完成登录"}
                    </Button>
                </div>
            </form>

            <div className="my-10 space-y-0">
                <div>
                    <button
                        type="button"
                        className="text-muted-foreground/70 text-xs hover:underline"
                        onClick={onReopenPopup}
                        disabled={pending}
                    >
                        重新打开弹窗
                    </button>
                </div>
                <RefreshTokenFooter
                    value={refreshTokenInput}
                    onChange={onRefreshTokenChange}
                    onSubmit={onSubmitRefreshToken}
                    pending={pending}
                />
            </div>
        </>
    );
}

function PopupSteps() {
    return (
        <ol className="space-y-2.5 text-muted-foreground text-sm">
            <li className="flex items-start gap-2.5">
                <StepBadge n={1} />
                <div className="flex items-center gap-1">
                    <span>
                        在<Strong>弹窗</Strong>里打开 Dev Tools，按
                    </span>
                    <Kbd>F12</Kbd>
                    <span>/</span>
                    <Kbd>⌘ ⌥ I</Kbd>
                </div>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={2} />
                <span>
                    切到 <Strong>Network</Strong> 面板，勾上 <Strong>Preserve log / 持续记录</Strong>
                </span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={3} />
                <div className="flex items-center gap-1">
                    <span>
                        在 Network 顶部的 <Strong>Filter 输入框</Strong> 输入
                    </span>
                    <Code copyable>callback?</Code>
                </div>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={4} />
                <span>登录你的 Pixiv 账号</span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={5} />
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-1">
                        找到下面的请求，点击 <Kbd>右键</Kbd> → <Kbd>Copy / 复制</Kbd> → <Kbd>Copy URL / 复制链接</Kbd>
                    </div>
                    <div className="flex items-center gap-2.5 rounded-md bg-background px-2.5 py-2 font-mono text-xs ring-1 ring-border">
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-700 dark:text-amber-400">
                            302
                        </span>
                        <span className="min-w-0 truncate">
                            <span className="text-muted-foreground">callback?state=xxx&amp;code=xxx</span>
                        </span>
                        <span className="ml-auto shrink-0 truncate text-muted-foreground/80">app-api.pixiv.net</span>
                    </div>
                </div>
            </li>
        </ol>
    );
}

function RefreshTokenFooter({
    value,
    onChange,
    onSubmit,
    pending,
}: {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
    pending: boolean;
}) {
    const [open, setOpen] = useState(false);
    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="select-none text-muted-foreground/70 text-xs hover:underline"
            >
                {open ? "已经有 Refresh Token 了！" : "已经有 Refresh Token 了？"}
            </button>
            {open && (
                <form onSubmit={onSubmit} className="max-w-sm space-y-2">
                    <Input
                        id="login-refresh-token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder="Paste your long-lived OAuth refresh token"
                    />
                    <div className="flex">
                        <Button type="submit" size="sm" disabled={pending || !value.trim()}>
                            {pending ? "登录中…" : "用 Token 登录"}
                        </Button>
                    </div>
                </form>
            )}
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

function Code({ className, children, copyable }: { className?: string; children: ReactNode; copyable?: boolean }) {
    const [copied, setCopied] = useState(false);

    if (!copyable) {
        return (
            <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs", className)}>
                {children}
            </code>
        );
    }

    const text = typeof children === "string" ? children : "";
    const handleCopy = async () => {
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Denied / unsupported (Safari, insecure context).
        }
    };

    return (
        <Tooltip>
            <TooltipTrigger
                delay={50}
                render={
                    <button
                        type="button"
                        onClick={handleCopy}
                        className={cn(
                            "cursor-pointer rounded bg-muted px-1.5 py-0.5 font-mono text-foreground text-xs transition-colors hover:bg-muted/80",
                            className,
                        )}
                    >
                        {children}
                    </button>
                }
            />
            <TooltipContent side="right">{copied ? "已复制" : "点击复制"}</TooltipContent>
        </Tooltip>
    );
}
