import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/api";
import { type ConfigView, patchConfig, resetConfig } from "./api";
import { nestedGet } from "./flatten";
import { parseConfigError } from "./parse-error";
import type { SectionSpec } from "./types";
import { baselineString, type FormValues, toPatchValue, validateClient } from "./values";

interface UseConfigFormParams {
    view: ConfigView | null;
    sections: SectionSpec[];
    // Called with the refreshed view returned by PATCH/RESET so the loader's
    // state stays the single source of truth.
    onView: (view: ConfigView) => void;
}

export interface UseConfigFormResult {
    values: FormValues;
    dirtyKeys: string[];
    // Keys with a persisted override in the file layer — i.e. those that have
    // something for reset to drop. Derived from `view.file`, not `sources`,
    // because restart-required keys keep a stale (startup) source while their
    // pending value already lives in `file`.
    overriddenKeys: Set<string>;
    fieldErrors: Record<string, string>;
    generalError: string | undefined;
    saving: boolean;
    busyKeys: Set<string>;
    setValue: (key: string, value: string) => void;
    save: () => Promise<void>;
    discard: () => void;
    resetField: (key: string) => Promise<void>;
    resetSection: (category: string) => Promise<void>;
    resetAll: () => Promise<void>;
}

export function useConfigForm({ view, sections, onView }: UseConfigFormParams): UseConfigFormResult {
    const fields = useMemo(() => sections.flatMap((s) => s.fields), [sections]);
    const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
    const knownKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);

    const [baseline, setBaseline] = useState<FormValues>({});
    const [values, setValues] = useState<FormValues>({});
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [generalError, setGeneralError] = useState<string | undefined>(undefined);
    const [saving, setSaving] = useState(false);
    const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

    const baselineRef = useRef<FormValues>(baseline);
    // Keys whose pending edits should be dropped (reset to baseline) on the
    // next reconcile, rather than preserved as user edits.
    const pendingDiscardRef = useRef<Set<string>>(new Set());

    // Reconcile form state whenever a fresh view arrives (initial load, save,
    // reset, or post-restart reconnect): adopt the new baseline, keep the
    // user's unsaved edits, but re-sync untouched/just-reset fields.
    useEffect(() => {
        if (!view || fields.length === 0) return;
        const nextBaseline: FormValues = {};
        for (const f of fields) nextBaseline[f.key] = baselineString(f, view);

        const oldBaseline = baselineRef.current;
        const discard = pendingDiscardRef.current;
        setValues((prev) => {
            const next: FormValues = { ...prev };
            for (const f of fields) {
                if (f.sensitive) {
                    next[f.key] = "";
                    continue;
                }
                const wasDirty = prev[f.key] !== undefined && prev[f.key] !== oldBaseline[f.key];
                if (discard.has(f.key) || prev[f.key] === undefined || !wasDirty) {
                    next[f.key] = nextBaseline[f.key];
                }
            }
            return next;
        });
        pendingDiscardRef.current = new Set();
        baselineRef.current = nextBaseline;
        setBaseline(nextBaseline);
    }, [view, fields]);

    const dirtyKeys = useMemo(
        () => fields.filter((f) => values[f.key] !== baseline[f.key]).map((f) => f.key),
        [fields, values, baseline],
    );

    const overriddenKeys = useMemo(() => {
        const set = new Set<string>();
        if (view) {
            for (const f of fields) {
                // Internal keys can only be reset by editing the file, so they
                // never count as UI-resettable — this keeps the per-section and
                // global reset controls from offering a no-op the backend rejects.
                if (!f.internal && nestedGet(view.file, f.key) !== undefined) set.add(f.key);
            }
        }
        return set;
    }, [fields, view]);

    const setValue = useCallback((key: string, value: string) => {
        setValues((prev) => ({ ...prev, [key]: value }));
        setFieldErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
        // A prior save error belongs to the previously submitted state; editing
        // makes it stale, so drop it (same-ref no-op when already clear).
        setGeneralError((prev) => (prev === undefined ? prev : undefined));
    }, []);

    const save = useCallback(async () => {
        const errs: Record<string, string> = {};
        const body: Record<string, unknown> = {};
        for (const key of dirtyKeys) {
            const field = fieldByKey.get(key);
            if (!field) continue;
            const clientError = validateClient(field, values[key]);
            if (clientError) {
                errs[key] = clientError;
                continue;
            }
            body[key] = toPatchValue(field, values[key]);
        }
        if (Object.keys(errs).length > 0) {
            setFieldErrors((prev) => ({ ...prev, ...errs }));
            return;
        }
        if (Object.keys(body).length === 0) return;

        setSaving(true);
        const { data, error } = await patchConfig(body);
        setSaving(false);

        if (error) {
            const parsed = parseConfigError(error, knownKeys);
            setFieldErrors(parsed.fields);
            setGeneralError(parsed.general);
            return;
        }
        if (data) {
            setFieldErrors({});
            setGeneralError(undefined);
            onView(data);
        }
    }, [dirtyKeys, fieldByKey, knownKeys, values, onView]);

    const discard = useCallback(() => {
        setValues({ ...baseline });
        setFieldErrors({});
        setGeneralError(undefined);
    }, [baseline]);

    const runReset = useCallback(
        async (keys: string[]) => {
            const targets = keys.filter((k) => overriddenKeys.has(k));
            if (targets.length === 0) return;
            setBusyKeys((prev) => {
                const next = new Set(prev);
                for (const k of targets) next.add(k);
                return next;
            });
            const { data, error } = await resetConfig({ keys: targets });
            setBusyKeys((prev) => {
                const next = new Set(prev);
                for (const k of targets) next.delete(k);
                return next;
            });
            if (error) {
                setGeneralError(apiErrorMessage(error));
                return;
            }
            if (data) {
                for (const k of targets) pendingDiscardRef.current.add(k);
                setFieldErrors((prev) => {
                    const next = { ...prev };
                    for (const k of targets) delete next[k];
                    return next;
                });
                onView(data);
            }
        },
        [overriddenKeys, onView],
    );

    const resetField = useCallback((key: string) => runReset([key]), [runReset]);

    const resetSection = useCallback(
        (category: string) => {
            const keys = fields.filter((f) => f.category === category).map((f) => f.key);
            return runReset(keys);
        },
        [fields, runReset],
    );

    const resetAll = useCallback(async () => {
        setBusyKeys(new Set(fields.map((f) => f.key)));
        const { data, error } = await resetConfig({ all: true });
        setBusyKeys(new Set());
        if (error) {
            setGeneralError(apiErrorMessage(error));
            return;
        }
        if (data) {
            for (const f of fields) pendingDiscardRef.current.add(f.key);
            setFieldErrors({});
            setGeneralError(undefined);
            onView(data);
        }
    }, [fields, onView]);

    return {
        values,
        dirtyKeys,
        overriddenKeys,
        fieldErrors,
        generalError,
        saving,
        busyKeys,
        setValue,
        save,
        discard,
        resetField,
        resetSection,
        resetAll,
    };
}
