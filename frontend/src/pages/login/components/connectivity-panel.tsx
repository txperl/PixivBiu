import { animate } from "animejs";
import { type SyntheticEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AuthApiError, checkConnectivity } from "@/features/auth/api";
import { useMessages } from "@/i18n";
import { ErrorBlock } from "./error-block";
import { useReveal } from "./use-reveal";

type Phase = "checking" | "ok" | "failed";

// MIN_CHECK_MS keeps the "checking"/"testing" beat on screen long enough to be
// felt even when the probe resolves in well under a second — otherwise a fast
// (e.g. direct) connection flashes straight to the result and the step reads as
// a blink rather than a gentle moment.
const MIN_CHECK_MS = 2200;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// probeWithDwell runs the connectivity probe but never resolves before
// MIN_CHECK_MS, by racing it against the timer concurrently — so the
// "checking"/"testing" beat is always perceptible, however fast the network
// answers.
function probeWithDwell(override?: string) {
    return Promise.all([checkConnectivity(override), delay(MIN_CHECK_MS)]).then(([result]) => result);
}

// useBreathe loops a gentle opacity pulse so the "checking" indicator feels
// alive while we wait. animejs rather than a CSS keyframe for the same reason
// use-reveal gives: stable timing across cold load and HMR.
function useBreathe<T extends HTMLElement = HTMLElement>() {
    return useCallback((el: T | null) => {
        if (!el) return;
        const anim = animate(el, {
            opacity: [0.35, 1],
            duration: 1500,
            ease: "inOutSine",
            loop: true,
            alternate: true,
        });
        return () => {
            anim.cancel();
        };
    }, []);
}

// ConnectivityPanel is the second beat of the login flow: before sign-in it
// gently confirms the backend can reach Pixiv. On success it offers a button
// that carries the user into login (that click is also what opens the OAuth
// popup — browsers only allow window.open from a real gesture). On failure it
// flows in a proxy input the user can test live; a working proxy is remembered
// server-side and the panel converges on the same "ok" state.
export function ConnectivityPanel({
    pending,
    error,
    onProceed,
}: {
    pending: boolean;
    error: AuthApiError | null;
    onProceed: () => void;
}) {
    const m = useMessages();
    const titleRef = useReveal<HTMLHeadingElement>(200);

    const [phase, setPhase] = useState<Phase>("checking");
    const [proxy, setProxy] = useState("");
    const [busy, setBusy] = useState(false);
    const [probeError, setProbeError] = useState<AuthApiError | null>(null);
    const [proxyMiss, setProxyMiss] = useState(false);

    // Probe the current configuration (no proxy override). Any failure — a real
    // API error or just "unreachable" — lands on the failed state so the proxy
    // input is offered either way.
    const runInitialCheck = useCallback(async () => {
        setPhase("checking");
        setProbeError(null);
        setProxyMiss(false);
        const { data, error: err } = await probeWithDwell();
        if (err) {
            setProbeError(err);
            setPhase("failed");
            return;
        }
        setPhase(data?.reachable ? "ok" : "failed");
    }, []);

    useEffect(() => {
        void runInitialCheck();
    }, [runInitialCheck]);

    const onTestProxy = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
        e.preventDefault();
        const candidate = proxy.trim();
        if (!candidate || busy) return;
        setBusy(true);
        setProbeError(null);
        setProxyMiss(false);
        const { data, error: err } = await probeWithDwell(candidate);
        setBusy(false);
        if (err) {
            setProbeError(err);
            return;
        }
        if (data?.reachable) {
            setPhase("ok"); // proxy now persisted server-side; the live client uses it
            return;
        }
        setProxyMiss(true);
    };

    const onRetryDirect = () => {
        setProxy("");
        void runInitialCheck();
    };

    return (
        <div className="flex flex-col gap-5">
            <h1 ref={titleRef} className="font-heading font-normal text-3xl text-foreground leading-tight">
                {m.login_connectivity_title()}
            </h1>

            {/* Keyed by phase so each state's content remounts and re-reveals,
                giving the same "flow in" cadence as the other panels. */}
            <div key={phase} aria-live="polite">
                {phase === "checking" && <CheckingView />}
                {phase === "ok" && <OkView pending={pending} error={error} onProceed={onProceed} />}
                {phase === "failed" && (
                    <FailedView
                        proxy={proxy}
                        onProxyChange={setProxy}
                        onSubmit={onTestProxy}
                        busy={busy}
                        proxyMiss={proxyMiss}
                        probeError={probeError}
                        onRetryDirect={onRetryDirect}
                        pending={pending}
                        error={error}
                        onProceed={onProceed}
                    />
                )}
            </div>
        </div>
    );
}

function CheckingView() {
    const m = useMessages();
    const ref = useReveal<HTMLDivElement>(300);
    const dotRef = useBreathe<HTMLSpanElement>();
    return (
        <div ref={ref} className="flex items-center gap-2.5 text-muted-foreground text-xl">
            <span
                ref={dotRef}
                className="inline-block size-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"
            />
            <span>{m.login_connectivity_checking()}</span>
        </div>
    );
}

function OkView({
    pending,
    error,
    onProceed,
}: {
    pending: boolean;
    error: AuthApiError | null;
    onProceed: () => void;
}) {
    const m = useMessages();
    const markRef = useReveal<HTMLDivElement>(100);
    const textRef = useReveal<HTMLParagraphElement>(200);
    const ctaRef = useReveal<HTMLDivElement>(350);
    return (
        <div className="flex flex-col gap-3">
            <div ref={markRef} className="text-xl">
                🔌
            </div>
            <p ref={textRef} className="max-w-lg text-muted-foreground text-xl">
                {m.login_connectivity_ok()}
            </p>
            <div ref={ctaRef} className="mt-2 space-y-3">
                <Button type="button" size="lg" onClick={onProceed} disabled={pending}>
                    {pending ? m.login_welcome_preparing() : m.login_connectivity_continue()}
                </Button>
                {error && <ErrorBlock error={error} />}
            </div>
        </div>
    );
}

function FailedView({
    proxy,
    onProxyChange,
    onSubmit,
    busy,
    proxyMiss,
    probeError,
    onRetryDirect,
    pending,
    error,
    onProceed,
}: {
    proxy: string;
    onProxyChange: (v: string) => void;
    onSubmit: (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
    busy: boolean;
    proxyMiss: boolean;
    probeError: AuthApiError | null;
    onRetryDirect: () => void;
    pending: boolean;
    error: AuthApiError | null;
    onProceed: () => void;
}) {
    const m = useMessages();
    const hintRef = useReveal<HTMLDivElement>(200);
    const formRef = useReveal<HTMLFormElement>(320);
    const footRef = useReveal<HTMLDivElement>(440);
    return (
        <div className="flex flex-col gap-4">
            <div ref={hintRef} className="max-w-lg space-y-1">
                <p className="text-foreground text-xl">{m.login_connectivity_failed_title()}</p>
                <p className="text-muted-foreground">{m.login_connectivity_failed_hint()}</p>
            </div>

            <form ref={formRef} onSubmit={onSubmit} className="max-w-md space-y-2.5">
                <div>
                    <label htmlFor="login-proxy" className="mb-1 block text-muted-foreground text-xs">
                        {m.login_connectivity_proxy_label()}
                    </label>
                    <Input
                        id="login-proxy"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                        value={proxy}
                        onChange={(e) => onProxyChange(e.target.value)}
                        placeholder={m.login_connectivity_proxy_placeholder()}
                        className="text-xs"
                    />
                </div>

                {proxyMiss && (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-700 text-xs dark:text-amber-300">
                        {m.login_connectivity_proxy_failed()}
                    </p>
                )}
                {probeError && <ErrorBlock error={probeError} />}

                <div className="flex">
                    <Button type="submit" disabled={busy || !proxy.trim()}>
                        {busy ? m.login_connectivity_testing() : m.login_connectivity_test()}
                    </Button>
                </div>
            </form>

            <div ref={footRef}>
                <div className="space-y-0">
                    <div>
                        <button
                            type="button"
                            onClick={onProceed}
                            disabled={pending || busy}
                            className="text-muted-foreground/70 text-xs hover:underline"
                        >
                            {pending ? m.login_welcome_preparing() : m.login_connectivity_skip()}
                        </button>
                    </div>
                    <div>
                        <button
                            type="button"
                            onClick={onRetryDirect}
                            disabled={busy}
                            className="text-muted-foreground/70 text-xs hover:underline"
                        >
                            {m.login_connectivity_retry()}
                        </button>
                    </div>
                </div>
                {error && (
                    <div className="mt-3">
                        <ErrorBlock error={error} />
                    </div>
                )}
            </div>
        </div>
    );
}
