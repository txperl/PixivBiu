import { Button } from "@/components/ui/button";
import { useReveal } from "./use-reveal";

export function ReadyPanel({ onContinue }: { onContinue: () => void }) {
    const sparkleRef = useReveal<HTMLSpanElement>(100);
    const titleRef = useReveal<HTMLHeadingElement>(200);
    const ctaRef = useReveal<HTMLDivElement>(450);

    return (
        <div className="flex flex-col gap-3">
            <div ref={sparkleRef} className="text-2xl text-muted-foreground/70">
                ✦
            </div>
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                哇哦
            </h1>
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                一切就绪，让我们开始吧！
            </h1>
            <div ref={ctaRef} className="mt-2">
                <Button type="button" size="lg" onClick={onContinue}>
                    进入 PixivBiu →
                </Button>
            </div>
        </div>
    );
}
