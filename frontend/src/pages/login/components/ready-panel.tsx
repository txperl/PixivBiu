import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { useReveal } from "./use-reveal";

export function ReadyPanel({ onContinue }: { onContinue: () => void }) {
    const m = useMessages();
    const sparkleRef = useReveal<HTMLSpanElement>(100);
    const titleRef = useReveal<HTMLHeadingElement>(200);
    const ctaRef = useReveal<HTMLDivElement>(450);

    return (
        <div className="flex flex-col gap-3">
            <div ref={sparkleRef} className="text-2xl text-muted-foreground/70">
                ✦
            </div>
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                {m.login_ready_wow()}
            </h1>
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                {m.login_ready_title()}
            </h1>
            <div ref={ctaRef} className="mt-2">
                <Button type="button" size="lg" onClick={onContinue}>
                    {m.login_ready_cta()}
                </Button>
            </div>
        </div>
    );
}
