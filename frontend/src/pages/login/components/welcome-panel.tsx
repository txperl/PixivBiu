import { Button } from "@/components/ui/button";
import type { AuthApiError } from "@/features/auth/api";
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
    const titleRef = useReveal<HTMLHeadingElement>(300);
    const subtitleRef = useReveal<HTMLParagraphElement>(300);
    const v3BrandRef = useReveal<HTMLSpanElement>(100);
    const ctaRef = useReveal<HTMLDivElement>(450);

    return (
        <div className="flex flex-col gap-5">
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                👋 你好呀
            </h1>
            <div ref={subtitleRef} className="max-w-lg space-y-1 text-muted-foreground text-xl">
                <p className="flex items-center">
                    欢迎来到 PixivBiu
                    <span
                        ref={v3BrandRef}
                        className="ml-1 rounded-sm bg-accent px-1.75 py-0.75 font-mono text-accent-foreground text-xs"
                    >
                        v3
                    </span>
                </p>
                <p>开始的开始，我们需要进行一些设置</p>
            </div>

            <div ref={ctaRef} className="mt-4 space-y-3">
                <Button type="button" size="lg" onClick={onClickPixivLogin} disabled={pending}>
                    {pending ? "正在准备…" : "让我们开始吧~"}
                </Button>
                {error && <ErrorBlock error={error} />}
            </div>
        </div>
    );
}
