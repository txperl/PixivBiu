import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn(
                "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-transparent outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-disabled:cursor-not-allowed data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:opacity-50 dark:bg-input/30 dark:data-checked:bg-primary",
                className,
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator className="flex items-center justify-center">
                <HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={2.5} />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}

export { Checkbox };
