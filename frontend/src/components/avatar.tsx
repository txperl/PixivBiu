type AvatarProps = {
    hue: number;
    initial: string;
    size?: number;
    className?: string;
};

function Avatar({ hue, initial, size = 32, className }: AvatarProps) {
    return (
        <div
            className={`flex shrink-0 items-center justify-center rounded-full font-medium text-white ${className ?? ""}`}
            style={{
                width: size,
                height: size,
                fontSize: size * 0.42,
                background: `linear-gradient(135deg, oklch(0.88 0.06 ${hue}), oklch(0.76 0.10 ${hue}))`,
                boxShadow: "0 0 0 2px rgba(255,255,255,.8)",
            }}
        >
            {initial}
        </div>
    );
}

export default Avatar;
