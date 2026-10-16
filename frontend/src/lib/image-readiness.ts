type ImageCallbacks = {
    onLoad: () => void;
    onReady: () => void;
    onError: () => void;
};

// Subscribe before inspecting complete: cached images may not deliver a load
// event. Each subscription decodes once; cleanup revokes even an in-flight decode.
// Waiting for load preserves native lazy loading for off-screen images.
export function observeImageReadiness(img: HTMLImageElement, callbacks: ImageCallbacks): () => void {
    const src = img.src;
    let active = true;
    let started = false;
    let failed = false;
    const current = () => active && img.src === src;
    const fail = () => {
        if (!current() || failed) return;
        failed = true;
        callbacks.onError();
    };
    const load = () => {
        if (!current() || started || failed) return;
        started = true;
        callbacks.onLoad();
        img.decode().then(() => {
            if (!current() || failed) return;
            if (img.naturalWidth > 0) callbacks.onReady();
            else fail();
        }, fail);
    };
    img.addEventListener("load", load);
    img.addEventListener("error", fail);
    if (img.complete) {
        if (img.naturalWidth > 0) load();
        else fail();
    }
    return () => {
        active = false;
        img.removeEventListener("load", load);
        img.removeEventListener("error", fail);
    };
}
