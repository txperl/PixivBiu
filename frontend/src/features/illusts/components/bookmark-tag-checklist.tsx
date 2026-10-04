import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useMessages } from "@/i18n";
import { LoaderIcon, PlusIcon, SearchIcon } from "@/lib/icons";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { normalizeBookmarkTags, validBookmarkTags } from "../bookmark-state";
import { BookmarkTagScrollArea } from "./bookmark-tag-scroll-area";

export function BookmarkTagChecklist({
    values,
    suggestions,
    artworkTags,
    disabled,
    loading,
    saving,
    status,
    canLoadMore,
    onLoadMore,
    onChange,
}: {
    values: string[];
    suggestions: string[];
    artworkTags: string[];
    disabled: boolean;
    loading: boolean;
    saving: boolean;
    status?: ReactNode;
    canLoadMore: boolean;
    onLoadMore: () => Promise<unknown>;
    onChange: (tags: string[]) => boolean;
}) {
    const m = useMessages();
    const id = useId();
    const [remembered, setRemembered] = useState(() => normalizeBookmarkTags([...suggestions, ...values]));
    useEffect(() => {
        setRemembered((current) => {
            const next = normalizeBookmarkTags([...current, ...suggestions, ...values]);
            return next.length === current.length ? current : next;
        });
    }, [suggestions, values]);
    const [search, setSearch] = useState("");
    const [invalid, setInvalid] = useState(false);
    const delayedLoading = useDelayedFlag(loading, 250);
    const showLoading = saving || (loading && delayedLoading);
    const artworkNames = normalizeBookmarkTags(artworkTags);
    const artworkSet = new Set(artworkNames);
    const names = normalizeBookmarkTags([...remembered, ...suggestions, ...values]).filter(
        (name) => !artworkSet.has(name),
    );
    const exact = search.trim();
    const matches = names.filter((name) => name.toLocaleLowerCase().includes(exact.toLocaleLowerCase()));
    const adopt = (next: string[]) => {
        if (disabled) return false;
        const normalized = normalizeBookmarkTags(next);
        if (!validBookmarkTags(normalized)) {
            setInvalid(true);
            return false;
        }
        if (!onChange(normalized)) return false;
        setRemembered((current) => normalizeBookmarkTags([...current, ...values, ...normalized]));
        setInvalid(false);
        return true;
    };
    const create = () => {
        if (exact && adopt([...values, exact])) {
            setSearch("");
        }
    };
    return (
        <div>
            <div className="relative border-border/60 border-b transition-colors focus-within:border-ring">
                <HugeiconsIcon
                    icon={SearchIcon}
                    size={14}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    aria-label={m.bookmark_quick_search()}
                    placeholder={m.bookmark_quick_search()}
                    value={search}
                    className="h-9 rounded-none border-0 pr-9 pl-[2.375rem] focus-visible:bg-muted/30 focus-visible:ring-0"
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
                        event.preventDefault();
                        create();
                    }}
                />
                {showLoading && (
                    <span
                        role="status"
                        aria-label={saving ? m.bookmark_saving() : m.bookmark_loading()}
                        className="absolute top-1/2 right-3 -translate-y-1/2"
                    >
                        <HugeiconsIcon icon={LoaderIcon} size={14} className="animate-spin text-muted-foreground" />
                    </span>
                )}
            </div>
            <div className="flex h-40 flex-col">
                <BookmarkTagScrollArea
                    className="min-h-0 flex-1"
                    canLoadMore={canLoadMore && !exact}
                    onLoadMore={onLoadMore}
                >
                    <fieldset aria-label={m.bookmark_existing_tags()}>
                        {matches.map((name, index) => (
                            <label
                                key={name}
                                htmlFor={`${id}-${index}`}
                                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-muted data-disabled:pointer-events-none"
                                data-disabled={disabled ? "" : undefined}
                            >
                                <Checkbox
                                    id={`${id}-${index}`}
                                    checked={values.includes(name)}
                                    disabled={disabled}
                                    className="data-disabled:opacity-100"
                                    onCheckedChange={(checked, details) => {
                                        if (!adopt(checked ? [...values, name] : values.filter((tag) => tag !== name)))
                                            details.cancel();
                                    }}
                                />
                                <span className="min-w-0 break-words">{name}</span>
                            </label>
                        ))}
                        {exact && !names.includes(exact) && !artworkSet.has(exact) && (
                            <Button
                                type="button"
                                variant="ghost"
                                disabled={disabled}
                                onClick={create}
                                className="h-auto w-full justify-start gap-2.5 whitespace-normal rounded-none px-3 text-left text-primary disabled:opacity-100"
                            >
                                <HugeiconsIcon icon={PlusIcon} className="size-4 shrink-0" />
                                <span className="min-w-0 break-words">{m.bookmark_tag_create({ tag: exact })}</span>
                            </Button>
                        )}
                        {!exact && names.length === 0 && !loading && !saving && !canLoadMore && !status && (
                            <p className="px-3 py-2 text-muted-foreground text-xs">{m.bookmark_no_tags()}</p>
                        )}
                    </fieldset>
                </BookmarkTagScrollArea>
                {status && <div className="shrink-0 border-border/60 border-t">{status}</div>}
            </div>
            {artworkNames.length > 0 && (
                <fieldset
                    aria-label={m.bookmark_quick_artwork_tags()}
                    className="space-y-1.5 border-border/60 border-t px-3 py-2 text-xs"
                >
                    <p className="text-muted-foreground">{m.bookmark_quick_artwork_tags()}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {artworkNames.map((name) => (
                            <Button
                                key={name}
                                type="button"
                                variant="outline"
                                size="xs"
                                aria-pressed={values.includes(name)}
                                disabled={disabled}
                                onClick={() =>
                                    adopt(
                                        values.includes(name)
                                            ? values.filter((tag) => tag !== name)
                                            : [...values, name],
                                    )
                                }
                                className="max-w-full border-border/60 bg-muted/30 font-normal text-muted-foreground disabled:opacity-100 aria-pressed:border-primary/30 aria-pressed:bg-primary/10 aria-pressed:text-primary aria-pressed:hover:bg-primary/15"
                            >
                                <span className="truncate">{name}</span>
                            </Button>
                        ))}
                    </div>
                </fieldset>
            )}
            {invalid && (
                <p role="alert" className="px-3 py-2 text-destructive text-xs">
                    {m.bookmark_tag_invalid()}
                </p>
            )}
        </div>
    );
}
