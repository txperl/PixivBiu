// Page size for the Downloads management page (passed as per_page to the API).
export const DOWNLOADS_PAGE_SIZE = 20;

// Tracked-jobs map keeps a job after it enters a terminal state for this
// long, so card buttons keep showing the "just finished" / "failed" cue
// and the recents sheet shows a small backlog. After the TTL the entry
// is swept out.
export const TRACKED_TTL_MS = 30 * 60 * 1000;

// How often the tracked-jobs sweep timer runs.
export const TRACKED_SWEEP_INTERVAL_MS = 60 * 1000;

// SSE job.* events trigger a refetch of the current downloads page,
// debounced so a burst of state changes coalesces into one request.
export const PAGE_REFETCH_DEBOUNCE_MS = 300;

// Cap on the initial fetch sizes for the tracked map (matches the
// backend per_page upper bound). Active + recent-terminal each get one
// request; both go through the same listDownloads endpoint.
export const TRACKED_INITIAL_FETCH_LIMIT = 100;
