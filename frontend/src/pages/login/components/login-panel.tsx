import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, type SyntheticEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AuthApiError } from "@/features/auth/api";
import type { PasteIssue } from "@/features/auth/utils";
import { useMessages } from "@/i18n";
import { PasteIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { ErrorBlock } from "./error-block";
import { useReveal } from "./use-reveal";

export function LoginPanel({
    pastedCode,
    onPastedCodeChange,
    pasteIssue,
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
    pasteIssue: PasteIssue | null;
    pending: boolean;
    error: AuthApiError | null;
    onPasteFromClipboard: () => void;
    onReopenPopup: () => void;
    onSubmit: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
    refreshTokenInput: string;
    onRefreshTokenChange: (v: string) => void;
    onSubmitRefreshToken: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
}) {
    const m = useMessages();
    const titleRef = useReveal<HTMLHeadingElement>(200);
    const subtitleRef = useReveal<HTMLParagraphElement>(300);
    const formRef = useReveal<HTMLFormElement>(450);

    const pasteHint =
        pasteIssue === "intermediate"
            ? m.login_paste_hint_intermediate()
            : pasteIssue === "pixiv"
              ? m.login_paste_hint_pixiv()
              : pasteIssue === "generic"
                ? m.login_paste_hint_generic()
                : null;

    return (
        <>
            <div className="space-y-1">
                <h1 ref={titleRef} className="font-heading font-normal text-2xl text-foreground leading-tight">
                    {m.login_title()}
                </h1>
                <p ref={subtitleRef} className="max-w-lg text-muted-foreground">
                    {m.login_subtitle()}
                </p>
            </div>

            <form ref={formRef} onSubmit={onSubmit} className="mt-10 space-y-3.5">
                <PopupSteps />

                <div>
                    <label htmlFor="login-callback-url" className="mb-1 block text-muted-foreground text-xs">
                        {m.login_callback_label()}
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
                                        aria-label={m.common_copy_from_clipboard()}
                                        className="absolute inset-y-1 right-1 flex items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                                    >
                                        <HugeiconsIcon icon={PasteIcon} size={14} strokeWidth={2} />
                                    </button>
                                }
                            />
                            <TooltipContent>{m.common_copy_from_clipboard()}</TooltipContent>
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
                        {pending ? m.login_submitting() : m.login_submit()}
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
                        {m.login_reopen_popup()}
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
    const m = useMessages();
    return (
        <ol className="space-y-2.5 text-muted-foreground text-sm">
            <li className="flex items-start gap-2.5">
                <StepBadge n={1} />
                <div className="flex items-center gap-1">
                    <span>
                        {m.login_step1_prefix()}
                        <Strong>{m.login_step1_popup()}</Strong>
                        {m.login_step1_suffix()}
                    </span>
                    <Kbd>F12</Kbd>
                    <span>/</span>
                    <Kbd>⌘ ⌥ I</Kbd>
                </div>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={2} />
                <span>
                    {m.login_step2_prefix()} <Strong>{m.login_step2_network()}</Strong> {m.login_step2_mid()}{" "}
                    <Strong>{m.login_step2_preserve()}</Strong>
                </span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={3} />
                <div className="flex items-center gap-1">
                    <span>
                        {m.login_step3_prefix()} <Strong>{m.login_step3_filter_box()}</Strong> {m.login_step3_suffix()}
                    </span>
                    <Code copyable>callback?</Code>
                </div>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={4} />
                <span>{m.login_step4()}</span>
            </li>
            <li className="flex items-start gap-2.5">
                <StepBadge n={5} />
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-1">
                        {m.login_step5_prefix()} <Kbd>{m.login_step5_right_click()}</Kbd> →{" "}
                        <Kbd>{m.login_step5_copy()}</Kbd> → <Kbd>{m.login_step5_copy_url()}</Kbd>
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
    const m = useMessages();
    const [open, setOpen] = useState(false);
    return (
        <div className="space-y-2">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="select-none text-muted-foreground/70 text-xs hover:underline"
            >
                {open ? m.login_have_token_open() : m.login_have_token_closed()}
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
                        placeholder={m.login_token_placeholder()}
                    />
                    <div className="flex">
                        <Button type="submit" size="sm" disabled={pending || !value.trim()}>
                            {pending ? m.login_submitting() : m.login_token_submit()}
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
    const m = useMessages();
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
            <TooltipContent side="right">{copied ? m.common_copied() : m.common_copy()}</TooltipContent>
        </Tooltip>
    );
}
