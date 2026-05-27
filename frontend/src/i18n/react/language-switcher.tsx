import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { type Locale, locales } from "../generated/runtime";
import { useLocale } from "./locale-provider";

// language names shown as endonyms; intentionally not localized
const NATIVE_NAMES: Record<Locale, string> = {
    en: "English",
    "zh-CN": "简体中文",
    ja: "日本語",
};

function LanguageSwitcher({ className }: { className?: string }) {
    const m = useMessages();
    const { locale, setLocale } = useLocale();

    const items = locales.map((l) => ({ label: NATIVE_NAMES[l], value: l }));

    return (
        <Select items={items} value={locale} onValueChange={(v) => v && setLocale(v)}>
            <SelectTrigger className={cn(className)} aria-label={m.common_language()}>
                <SelectValue placeholder={m.common_select_language()} />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}

export default LanguageSwitcher;
