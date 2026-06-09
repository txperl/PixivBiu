import { cn } from "@/lib/utils";

type IllustPlaceholderArtProps = {
    hue: number;
    ratio?: "4/5" | "1/1" | "3/4";
    rounded?: number;
    // Fill the parent on both axes (size-full) instead of imposing `ratio`. Use
    // when the container already owns the aspect ratio (e.g. the card's preview
    // popover box), so the placeholder matches the box rather than going square.
    fill?: boolean;
    className?: string;
    children?: React.ReactNode;
};

// Stripe-and-blur tile that stands in for real artwork. Hue is data-driven, so
// inline style is unavoidable here.
function IllustPlaceholderArt({
    hue,
    ratio = "1/1",
    rounded = 12,
    fill = false,
    className,
    children,
}: IllustPlaceholderArtProps) {
    const a = `oklch(0.88 0.05 ${hue})`;
    const b = `oklch(0.93 0.035 ${hue})`;
    return (
        <div
            className={cn("relative overflow-hidden", fill ? "size-full" : "w-full", className)}
            style={{
                aspectRatio: fill ? undefined : ratio,
                borderRadius: rounded,
                background: `repeating-linear-gradient(135deg, ${a} 0 10px, ${b} 10px 20px)`,
            }}
        >
            <div className="absolute inset-0 bg-gradient-to-b from-40% from-white/0 to-[rgba(40,30,25,0.08)]" />
            <div
                className="absolute rounded-md"
                style={{
                    left: "18%",
                    top: "24%",
                    right: "22%",
                    bottom: "28%",
                    background: `oklch(0.78 0.09 ${hue} / 0.55)`,
                    filter: "blur(6px)",
                }}
            />
            <div
                className="absolute rounded-md"
                style={{
                    left: "26%",
                    top: "34%",
                    right: "34%",
                    bottom: "40%",
                    background: `oklch(0.65 0.12 ${hue} / 0.55)`,
                    filter: "blur(10px)",
                }}
            />
            {children}
        </div>
    );
}

export default IllustPlaceholderArt;
