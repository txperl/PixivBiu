type IllustPlaceholderArtProps = {
    hue: number;
    ratio?: "4/5" | "1/1" | "3/4";
    rounded?: number;
    className?: string;
    children?: React.ReactNode;
};

// Stripe-and-blur tile that stands in for real artwork. Hue is data-driven, so
// inline style is unavoidable here.
function IllustPlaceholderArt({ hue, ratio = "1/1", rounded = 12, className, children }: IllustPlaceholderArtProps) {
    const a = `oklch(0.88 0.05 ${hue})`;
    const b = `oklch(0.93 0.035 ${hue})`;
    return (
        <div
            className={`relative w-full overflow-hidden ${className ?? ""}`}
            style={{
                aspectRatio: ratio,
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
