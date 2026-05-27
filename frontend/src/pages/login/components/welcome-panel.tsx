import { Button } from "@/components/ui/button";
import type { AuthApiError } from "@/features/auth/api";
import { useMessages } from "@/i18n";
import { ErrorBlock } from "./error-block";
import { useReveal } from "./use-reveal";

export function WelcomePanel({
    pending,
    error,
    onClickPixivLogin,
}: {
    pending: boolean;
    error: AuthApiError | null;
    onClickPixivLogin: () => void;
}) {
    const m = useMessages();
    const titleRef = useReveal<HTMLHeadingElement>(300);
    const subtitleRef = useReveal<HTMLParagraphElement>(300);
    const v3BrandRef = useReveal<HTMLSpanElement>(100);
    const ctaRef = useReveal<HTMLDivElement>(450);

    return (
        <div className="flex flex-col gap-5">
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                {m.login_welcome_greeting()}
            </h1>
            <div ref={subtitleRef} className="max-w-lg space-y-1 text-muted-foreground text-xl">
                <p className="flex items-center">
                    {m.login_welcome_intro()}
                    <span
                        ref={v3BrandRef}
                        className="ml-1 rounded-sm bg-accent px-1.75 py-0.75 font-mono text-accent-foreground text-xs"
                    >
                        v3
                    </span>
                </p>
                <p>{m.login_welcome_setup()}</p>
            </div>

            <div ref={ctaRef} className="mt-4 space-y-3">
                <Button type="button" size="lg" onClick={onClickPixivLogin} disabled={pending}>
                    {pending ? m.login_welcome_preparing() : m.login_welcome_cta()}
                </Button>
                {error && <ErrorBlock error={error} />}
            </div>
        </div>
    );
}
