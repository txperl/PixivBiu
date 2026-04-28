import { cn } from "@/lib/utils";
import { type Locale, locales } from "../generated/runtime";
import { useLocale } from "./LocaleProvider";

// 各语言用本族名展示，避免"X 在 Y 中怎么说"的翻译问题
const NATIVE_NAMES: Record<Locale, string> = {
    en: "English",
    "zh-CN": "简体中文",
    ja: "日本語",
};

export function LanguageSwitcher({ className }: { className?: string }) {
    const { locale, setLocale } = useLocale();
    return (
        <select
            className={cn(
                "rounded-md bg-transparent px-2 py-1 text-sm outline-none hover:bg-sidebar-accent",
                className,
            )}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            aria-label="Language"
        >
            {locales.map((l) => (
                <option key={l} value={l}>
                    {NATIVE_NAMES[l]}
                </option>
            ))}
        </select>
    );
}
