import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { useReveal } from "./use-reveal";

export function WelcomePanel({ onContinue, sessionExpired }: { onContinue: () => void; sessionExpired?: boolean }) {
    const m = useMessages();
    const titleRef = useReveal<HTMLHeadingElement>(300);
    const subtitleRef = useReveal<HTMLParagraphElement>(300);
    const v3BrandRef = useReveal<HTMLSpanElement>(100);
    const ctaRef = useReveal<HTMLDivElement>(450);

    return (
        <div className="flex flex-col gap-5">
            {sessionExpired && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 text-sm dark:text-amber-400">
                    {m.login_session_expired()}
                </div>
            )}
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
                <Button type="button" size="lg" onClick={onContinue}>
                    {m.login_welcome_cta()}
                </Button>
            </div>
        </div>
    );
}
