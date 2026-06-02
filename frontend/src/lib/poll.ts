export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls `probe` every `interval` ms (after an initial `interval` delay) until it
// resolves true or `timeout` ms elapse; returns whether the condition was met.
// Used to wait out a backend self-restart (re-exec) before adopting new state —
// the probe swallows the connection-refused gap and reports readiness.
export async function pollUntil(
    probe: () => Promise<boolean>,
    { interval, timeout }: { interval: number; timeout: number },
): Promise<boolean> {
    const deadline = Date.now() + timeout;
    await sleep(interval);
    while (Date.now() < deadline) {
        if (await probe()) return true;
        await sleep(interval);
    }
    return false;
}
