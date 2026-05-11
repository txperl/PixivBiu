import { animate, createSpring, type JSAnimation, stagger } from "animejs";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type LeapyLoadingProps = {
    className?: string;
    size?: number;
};

const BASE_SIZE = 5;

function LeapyLoading({ className, size = BASE_SIZE }: LeapyLoadingProps) {
    const boxRef = useRef<HTMLDivElement>(null);
    const scale = size / BASE_SIZE;

    useEffect(() => {
        if (!boxRef.current) return;
        const dotElements = boxRef.current.querySelectorAll("div");
        let currentAnimation: JSAnimation | null = null;
        currentAnimation = animate(dotElements, {
            scale: { from: 0.1, to: 1, duration: 300, ease: createSpring({ stiffness: 100, damping: 12, mass: 1 }) },
            y: {
                from: 18 * scale,
                to: 4 * scale,
                duration: 300,
                ease: createSpring({ stiffness: 90, damping: 15, mass: 1 }),
            },
            opacity: { from: 0, to: 1, duration: 420, ease: createSpring({ stiffness: 100, damping: 20, mass: 1 }) },
            delay: stagger(50),
            onComplete: () => {
                currentAnimation = animate(dotElements, {
                    y: [
                        {
                            from: 4 * scale,
                            to: -4 * scale,
                            ease: createSpring({ stiffness: 200, damping: 25, mass: 1 }),
                        },
                        {
                            from: -4 * scale,
                            to: 4 * scale,
                            ease: createSpring({ stiffness: 200, damping: 25, mass: 1 }),
                            delay: 400,
                        },
                    ],
                    delay: stagger(150),
                    loop: true,
                    loopDelay: 0,
                });
            },
        });
        return () => {
            currentAnimation?.cancel();
        };
    }, [scale]);

    return (
        <div className={cn("inline-flex flex-row", className)} style={{ gap: 3 * scale }} ref={boxRef}>
            {[0, 1, 2].map((v) => (
                <div key={v} className="rounded-full bg-current" style={{ width: size, height: size }} />
            ))}
        </div>
    );
}

export default LeapyLoading;
