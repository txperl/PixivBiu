// Pre-core presentation: transitions-dev Matrix dot loader + Texts reveal.
// The fixed script is hash-authorized only on the authored startup document.
export const STARTUP_SCRIPT = `
const block = document.querySelector(".startup .t-stagger");
if (block) {
    const delay = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue("--startup-status-delay"));
    function showText() {
        block.classList.remove("is-hiding");
        block.classList.remove("is-shown");
        void block.offsetHeight;
        block.classList.add("is-shown");
    }
    const timer = setTimeout(showText, delay);
    window.addEventListener("pagehide", () => clearTimeout(timer), { once: true });
}
`;

export function startupScreen(): string {
    const cycle = 1200;
    const dots = Array.from({ length: 16 }, (_, index) => {
        const row = Math.floor(index / 4);
        const column = index % 4;
        // Equal diagonals pulse together; successive diagonals travel down/right.
        return `<i style="--d:${(row + column) * cycle / 10}"></i>`;
    }).join("");

    return `<style>
:root {
  --matrix-cycle: 1200ms;
  --matrix-base: #d9d9d9;
  --matrix-active: #85858f;
  --matrix-ease: ease-in-out;
}

.t-matrix {
  display: grid;
  grid-template-columns: repeat(4, 2px);
  grid-auto-rows: 2px;
  gap: 2px;
}
.t-matrix i {
  display: block;
  background: var(--matrix-base);
  animation: t-matrix-pulse var(--matrix-cycle) var(--matrix-ease) infinite;
  animation-delay: calc(var(--d, 0) * 1ms);
}
/* Hole positions (rounded variants) render nothing. */
.t-matrix i.is-gap { visibility: hidden; animation: none; }
@keyframes t-matrix-pulse {
  0%, 45%, 100% { background-color: var(--matrix-base); }
  15%           { background-color: var(--matrix-active); }
}

@media (prefers-reduced-motion: reduce) {
  .t-matrix i { animation: none !important; }
}

:root {
  --stagger-dur: 500ms;
  --stagger-distance: 12px;
  --stagger-stagger: 40ms;
  --stagger-blur: 3px;
  --stagger-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

/* Lines start translated down + blurred + invisible; .is-shown
   on the parent flips them to their resting state. The second
   line's transition-delay holds it back by --stagger-stagger
   so the eye lands on the headline first. */
.t-stagger-line {
  display: block;
  opacity: 0;
  transform: translateY(var(--stagger-distance));
  filter: blur(var(--stagger-blur));
  transition:
    opacity   var(--stagger-dur) var(--stagger-ease),
    transform var(--stagger-dur) var(--stagger-ease),
    filter    var(--stagger-dur) var(--stagger-ease);
  will-change: transform, opacity, filter;
}
.t-stagger-line--2 { transition-delay: var(--stagger-stagger); }

.t-stagger.is-shown .t-stagger-line {
  opacity: 1;
  transform: translateY(0);
  filter: blur(0);
}
/* Exit decouples from the stagger: same fade for every line,
   no Y return, no blur — so the disappearance reads as a
   single quiet fade instead of a reverse reveal. */
.t-stagger.is-hiding .t-stagger-line {
  opacity: 0;
  transform: translateY(0);
  filter: blur(0);
  transition:
    opacity 200ms ease,
    transform 0s linear,
    filter 0s linear;
  transition-delay: 0s;
}

@media (prefers-reduced-motion: reduce) {
  .t-stagger-line { transition: none !important; }
}

        :root {
            --matrix-cycle: ${cycle}ms;
            --matrix-base: var(--shell-page-matrix-base);
            --matrix-active: var(--shell-page-accent);
            --startup-status-delay: 3000ms;
        }
        .startup {
            box-sizing: border-box;
            min-height: calc(100dvh - var(--chrome-height));
            display: grid;
            place-items: center;
            padding: 32px;
        }
        .startup-content { position: relative; }
        .startup .t-matrix {
            grid-template-columns: repeat(4, 4px);
            grid-auto-rows: 4px;
            gap: 4px;
        }
        .startup-status {
            position: absolute;
            top: calc(100% + 24px);
            left: 50%;
            transform: translateX(-50%);
            width: max-content;
            max-width: calc(100vw - 64px);
            text-align: center;
            color: var(--shell-page-muted);
            font-size: 13px;
        }
        .startup-status p { margin: 0; }
        @media (prefers-reduced-motion: reduce) {
            .startup .t-matrix i { background: var(--matrix-active); }
        }
        @media (forced-colors: active) {
            .startup-status { color: CanvasText; }
            .startup .t-matrix i {
                animation: none !important;
                background: CanvasText;
                forced-color-adjust: none;
            }
            .t-stagger-line { transition: none !important; }
        }
    </style>
    <main class="startup">
        <div class="startup-content">
            <div class="t-matrix" data-variant="diagonal" aria-hidden="true">${dots}</div>
            <div class="startup-status t-stagger" role="status">
                <p class="t-stagger-line t-stagger-line--1">Opening PixivBiu…</p>
            </div>
        </div>
    </main>
    <script>${STARTUP_SCRIPT}</script>`;
}
