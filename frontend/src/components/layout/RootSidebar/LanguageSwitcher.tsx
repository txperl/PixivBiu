import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";
import { type Locale, locales } from "@/lib/i18n/generated/runtime";
import { cn } from "@/lib/utils";

// 各语言用本族名展示，避免"X 在 Y 中怎么说"的翻译问题
const NATIVE_NAMES: Record<Locale, string> = {
    en: "English",
    "zh-CN": "简体中文",
    ja: "日本語",
};

function LanguageSwitcher({ className }: { className?: string }) {
    const { locale, setLocale } = useLocale();

    const items = locales.map((l) => ({ label: NATIVE_NAMES[l], value: l }));

    return (
        <Select items={items} value={locale} onValueChange={(v) => setLocale(v)}>
            <SelectTrigger className={cn(className)}>
                <SelectValue placeholder="Select Language" />
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
