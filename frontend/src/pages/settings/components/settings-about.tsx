import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import LeapyOverlay from "@/components/series-leapy/leapy-overlay";
import { Sheet, SheetHead } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { type FieldSpec, SCROLL_OFFSET, SECTION_ICONS } from "@/features/settings";
import { type UpdateApiError, useUpdate } from "@/features/system";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { type FieldRowProps, SettingsFieldList } from "./settings-field-list";

// Element styles for the GitHub-generated release-notes markdown. react-markdown
// (v10) does not render raw HTML by default, so the body is safe to render inline.
// The project ships no @tailwindcss/typography plugin, so each element is mapped
// here to the same muted, small scale as the rest of the About card.
// All heading levels render the same here: one compact, bold line at the card's
// scale (the notes are short, so distinct h1…h4 sizes add nothing).
const ReleaseNotesHeading = ({ children }: { children?: ReactNode }) => (
    <p className="mt-3 mb-1 font-semibold text-foreground first:mt-0">{children}</p>
);

// Hoisted so the plugin list keeps a stable identity across renders.
const releaseNotesPlugins = [remarkGfm];

const releaseNotesComponents: Components = {
    h1: ReleaseNotesHeading,
    h2: ReleaseNotesHeading,
    h3: ReleaseNotesHeading,
    h4: ReleaseNotesHeading,
    p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
        </a>
    ),
    code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    hr: () => <hr className="my-2 border-border/60" />,
};

// Section id for the About card; shared with the settings page so the nav and
// scroll-spy (which key off data-section-id) treat it like a real section.
export const ABOUT_ID = "about";

interface SettingsAboutProps extends FieldRowProps {
    // The `about`-category schema fields (the update settings). They live in the
    // form like any other field; the About card renders them here instead of as
    // a normal section, gated by the advanced toggle.
    fields: FieldSpec[];
}

// SettingsAbout is a custom (non-schema) settings card: it shows the running
// version + build info and drives the one-click update flow. It participates
// in the settings nav / scroll-spy via the shared data-section-id contract.
export function SettingsAbout({
    fields,
    values,
    fieldErrors,
    sources,
    overriddenKeys,
    pendingRestart,
    busyKeys,
    showAdvanced,
    onChange,
    onResetField,
}: SettingsAboutProps) {
    const m = useMessages();
    const resolveApiError = useApiErrorMessage();
    const { status, systemVersion, checking, applying, updateAvailable, checkNow, apply } = useUpdate();
    const [checkFailed, setCheckFailed] = useState(false);
    const [applyError, setApplyError] = useState<UpdateApiError | null>(null);

    const isDev = status?.is_dev ?? false;
    const currentVersion = status?.current_version ?? systemVersion?.version ?? "—";
    const latest = status?.latest_version ?? "";
    const lastChecked = status?.last_checked;

    const onCheck = async () => {
        setCheckFailed(false);
        const err = await checkNow();
        setCheckFailed(!!err);
    };
    const onApply = async () => {
        setApplyError(null);
        const err = await apply();
        if (err) setApplyError(err);
    };

    // Precomputed to avoid a nested ternary in JSX.
    let statusNode: ReactNode;
    if (isDev) {
        statusNode = <p className="text-muted-foreground">{m.settings_about_dev_build()}</p>;
    } else if (updateAvailable) {
        statusNode = (
            <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="font-medium text-foreground">{m.settings_about_update_available({ version: latest })}</p>
                <div className="flex items-center gap-3">
                    <Button onClick={onApply} disabled={applying}>
                        {m.settings_about_apply()}
                    </Button>
                    {status?.release_url && (
                        <a
                            href={status.release_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted-foreground text-xs underline-offset-4 hover:underline"
                        >
                            {m.settings_about_release_notes_view_github()}
                        </a>
                    )}
                </div>
                {status?.release_notes && (
                    <div className="space-y-1">
                        <p className="font-medium text-[0.7rem] text-muted-foreground uppercase tracking-wide">
                            {m.settings_about_release_notes()}
                        </p>
                        <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-3 text-muted-foreground text-xs">
                            <Markdown remarkPlugins={releaseNotesPlugins} components={releaseNotesComponents}>
                                {status.release_notes}
                            </Markdown>
                        </div>
                    </div>
                )}
                {applyError && <p className="text-destructive text-xs">{resolveApiError(applyError)}</p>}
            </div>
        );
    } else {
        statusNode = <p className="text-muted-foreground">{m.settings_about_up_to_date()}</p>;
    }

    return (
        <section id={`section-${ABOUT_ID}`} data-section-id={ABOUT_ID} style={{ scrollMarginTop: SCROLL_OFFSET }}>
            <Sheet>
                <SheetHead
                    icon={SECTION_ICONS.about}
                    title={m.settings_about_title()}
                    actions={
                        <Button variant="outline" size="sm" onClick={onCheck} disabled={checking}>
                            {checking ? m.settings_about_checking() : m.settings_about_check_now()}
                        </Button>
                    }
                />
                <div className="space-y-4 px-[18px] py-4 text-sm">
                    {/* Version is the first item under About. */}
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{m.settings_about_version_label()}</span>
                        <span className="font-mono text-muted-foreground text-xs">{currentVersion}</span>
                    </div>

                    {systemVersion && (
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-muted-foreground">{m.settings_about_runtime_label()}</span>
                            <span className="font-mono text-muted-foreground text-xs">
                                {systemVersion.go_version} · {systemVersion.os}/{systemVersion.arch}
                            </span>
                        </div>
                    )}

                    {/* Authorship + open-source link — a static "Official" row that
                        sits directly under Runtime. */}
                    <div className="flex items-start justify-between gap-3">
                        <span className="text-muted-foreground">{m.settings_about_official_label()}</span>
                        <div className="flex items-end gap-2 text-muted-foreground text-xs">
                            <a
                                href="https://github.com/txperl/PixivBiu"
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 underline"
                            >
                                <HugeiconsIcon icon={GithubIcon} size={12} strokeWidth={2} />
                                {m.settings_about_open_source()}
                            </a>
                            <span>/</span>
                            {/* Authorship line is brand copy, intentionally not i18n'd. */}
                            <span>
                                Created by{" "}
                                <a
                                    href="https://github.com/txperl"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline"
                                >
                                    Trii Hsia
                                </a>{" "}
                                with ❤️
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-0.5 text-muted-foreground text-xs">
                        {statusNode && <div>{statusNode}</div>}
                        <div>
                            {checkFailed
                                ? m.settings_about_check_failed()
                                : lastChecked
                                  ? m.settings_about_last_checked({ time: new Date(lastChecked).toLocaleString() })
                                  : m.settings_about_never_checked()}
                        </div>
                    </div>
                </div>

                {/* Update settings (enabled / channel) — advanced tier, so they
                    only surface with the advanced toggle on. They render with the
                    same field rows as any other section. */}
                <SettingsFieldList
                    fields={fields}
                    className="border-muted/40 border-t"
                    values={values}
                    fieldErrors={fieldErrors}
                    sources={sources}
                    overriddenKeys={overriddenKeys}
                    pendingRestart={pendingRestart}
                    busyKeys={busyKeys}
                    showAdvanced={showAdvanced}
                    onChange={onChange}
                    onResetField={onResetField}
                />
            </Sheet>
            {applying && <LeapyOverlay label={m.settings_about_updating()} />}
        </section>
    );
}
