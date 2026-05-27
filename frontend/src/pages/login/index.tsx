import { type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import type { AuthApiError } from "@/features/auth/api";
import { useAuth } from "@/features/auth/use-auth";
import { detectPasteIssue } from "@/features/auth/utils";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { LoginPanel } from "./components/login-panel";
import { ReadyPanel } from "./components/ready-panel";
import { WelcomePanel } from "./components/welcome-panel";

type Stage = "welcome" | "login" | "ready";
type OAuthSession = { state: string; loginUrl: string };

const STAGES: Stage[] = ["welcome", "login", "ready"];

const POPUP_W = 480;
const POPUP_H = 720;
const POPUP_MARGIN = 24;
const POPUP_NAME = "pixivLogin";

// Anchor the popup to the right side of the current browser window so it
// doesn't cover the left-aligned login content. Coordinates are screen-space,
// so we add screenLeft/screenTop to handle multi-monitor setups.
function openPixivPopup(url: string) {
    const screenLeft = window.screenLeft ?? window.screenX;
    const screenTop = window.screenTop ?? window.screenY;
    const winW = window.outerWidth || document.documentElement.clientWidth;
    const winH = window.outerHeight || document.documentElement.clientHeight;
    const left = Math.max(screenLeft + POPUP_MARGIN, screenLeft + winW - POPUP_W - POPUP_MARGIN);
    const top = screenTop + Math.max(POPUP_MARGIN, (winH - POPUP_H + POPUP_MARGIN) / 2);
    const features = `popup,width=${POPUP_W},height=${POPUP_H},left=${left},top=${top}`;
    return window.open(url, POPUP_NAME, features);
}

function LoginPage() {
    const { status, pending, startOAuth, exchangeOAuth, login } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const intendedFrom = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

    const [stage, setStage] = useState<Stage>("welcome");
    const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
    const [pastedCode, setPastedCode] = useState("");
    const [refreshTokenInput, setRefreshTokenInput] = useState("");
    const [error, setError] = useState<AuthApiError | null>(null);
    const popupRef = useRef<Window | null>(null);
    // Once the user takes any login action, suppress the "already authenticated
    // → redirect" guard, so the flip from unauth → auth (which happens *inside*
    // the awaited API call) doesn't tear them away before we get to show the
    // ready panel.
    const interactedRef = useRef(false);

    const pasteIssue = useMemo(() => detectPasteIssue(pastedCode), [pastedCode]);

    // Close the Pixiv popup when leaving the page (auth has completed by then;
    // the popup's only purpose was capturing the callback URL).
    useEffect(() => {
        return () => {
            popupRef.current?.close();
            popupRef.current = null;
        };
    }, []);

    if (status?.authenticated && !interactedRef.current) {
        return <Navigate to={intendedFrom} replace />;
    }

    const onClickPixivLogin = async () => {
        interactedRef.current = true;
        setError(null);
        // Open the popup synchronously to preserve the user-gesture context;
        // browsers block window.open() once it's been reached through an
        // awaited call. We navigate the popup to the real URL after the
        // server responds.
        const popup = openPixivPopup("about:blank");
        popupRef.current = popup;

        const { data, error: err } = await startOAuth();
        if (err || !data) {
            popup?.close();
            popupRef.current = null;
            setError(err ?? { code: "internal_error", message: "Failed to start OAuth" });
            return;
        }
        setOauthSession({ state: data.state, loginUrl: data.login_url });
        if (popup && !popup.closed) {
            popup.location.replace(data.login_url);
        } else {
            popupRef.current = openPixivPopup(data.login_url);
        }
        setStage("login");
    };

    const onReopenPopup = () => {
        if (!oauthSession) return;
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.focus();
            return;
        }
        popupRef.current = openPixivPopup(oauthSession.loginUrl);
    };

    const onPasteFromClipboard = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) setPastedCode(text);
        } catch {
            // Denied / unsupported (Safari, insecure context): manual paste still works.
        }
    };

    const onSubmitPasted = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
        e.preventDefault();
        if (!oauthSession) return;
        interactedRef.current = true;
        setError(null);
        const err = await exchangeOAuth(oauthSession.state, pastedCode);
        if (err) {
            setError(err);
            return;
        }
        setStage("ready");
    };

    const onSubmitRefreshToken = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
        e.preventDefault();
        interactedRef.current = true;
        setError(null);
        const err = await login(refreshTokenInput);
        if (err) {
            setError(err);
            return;
        }
        setStage("ready");
    };

    return (
        <div
            className={cn(
                "flex h-svh flex-col justify-between overflow-auto bg-background",
                "px-12 pt-16 pb-16 md:px-16 md:pt-20 lg:px-28 lg:pt-32",
            )}
        >
            <div className="max-w-xl">
                {stage === "welcome" && (
                    <WelcomePanel pending={pending} error={error} onClickPixivLogin={onClickPixivLogin} />
                )}
                {stage === "login" && (
                    <LoginPanel
                        pastedCode={pastedCode}
                        onPastedCodeChange={setPastedCode}
                        pasteIssue={pasteIssue}
                        pending={pending}
                        error={error}
                        onPasteFromClipboard={onPasteFromClipboard}
                        onReopenPopup={onReopenPopup}
                        onSubmit={onSubmitPasted}
                        refreshTokenInput={refreshTokenInput}
                        onRefreshTokenChange={setRefreshTokenInput}
                        onSubmitRefreshToken={onSubmitRefreshToken}
                    />
                )}
                {stage === "ready" && <ReadyPanel onContinue={() => navigate(intendedFrom, { replace: true })} />}
            </div>
            <StageIndicator stage={stage} />
        </div>
    );
}

function StageIndicator({ stage }: { stage: Stage }) {
    const m = useMessages();
    const current = STAGES.indexOf(stage);
    return (
        <div
            className="flex flex-row gap-1"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STAGES.length}
            aria-valuenow={current + 1}
            aria-label={m.login_progress()}
        >
            {STAGES.map((s, i) => (
                <div
                    key={s}
                    className={cn(
                        "size-3 rounded-full transition-colors duration-300",
                        i <= current ? "bg-muted-foreground/65" : "bg-muted",
                    )}
                />
            ))}
        </div>
    );
}

export default LoginPage;
