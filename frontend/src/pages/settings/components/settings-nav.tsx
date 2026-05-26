import { HugeiconsIcon } from "@hugeicons/react";
import type { SectionSpec } from "@/features/settings";
import { cn } from "@/lib/utils";

interface SettingsNavProps {
    sections: SectionSpec[];
    activeId: string | undefined;
    onSelect: (category: string) => void;
}

const baseClass =
    "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-full px-3.5 text-left text-sm transition-colors";
const activeClass = "bg-secondary font-semibold text-secondary-foreground";
const inactiveClass = "font-medium text-muted-foreground hover:bg-muted";

export function SettingsNav({ sections, activeId, onSelect }: SettingsNavProps) {
    return (
        <nav className="flex flex-col gap-1">
            {sections.map((section) => {
                const active = section.category === activeId;
                return (
                    <button
                        key={section.category}
                        type="button"
                        onClick={() => onSelect(section.category)}
                        className={cn(baseClass, active ? activeClass : inactiveClass)}
                    >
                        <HugeiconsIcon icon={section.icon} size={18} strokeWidth={active ? 2 : 1.5} />
                        <span className="flex-1">{section.title}</span>
                    </button>
                );
            })}
        </nav>
    );
}
