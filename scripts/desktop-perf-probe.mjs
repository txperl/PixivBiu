#!/usr/bin/env node
// Development probe for desktop rendering cost. Not part of CI.
//
// Start the shell with a DevTools port, sign in, leave it on Home, then run:
//   cd desktop && npx electron . --remote-debugging-port=9333
//   node scripts/desktop-perf-probe.mjs [--port 9333] [--load-more 4] [--json]
//
// It drives the live SPA over CDP: grows the Home feed, measures scroll frame
// pacing and compositor layerization, visits each sidebar section, and samples
// DOM/image size plus per-process memory (macOS `footprint`, else ps RSS).
// Results depend on account content and display refresh rate; compare runs on
// the same machine and account.
import { execFileSync } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const PORT = Number(option("port", 9333));
const LOAD_MORE = Number(option("load-more", 4));
const JSON_OUT = args.includes("--json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith("pixivbiu://core"));
  if (!page) throw new Error(`No pixivbiu://core page on port ${PORT}; is the shell running with --remote-debugging-port?`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  let traceEvents = [];
  let traceDone = null;
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Tracing.dataCollected") {
      traceEvents.push(...msg.params.value);
    } else if (msg.method === "Tracing.tracingComplete") {
      traceDone?.();
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
    return result.result.value;
  };
  const trace = async (run) => {
    traceEvents = [];
    await send("Tracing.start", {
      categories: "devtools.timeline,blink,cc,disabled-by-default-devtools.timeline",
      transferMode: "ReportEvents",
    });
    const value = await run();
    await new Promise((resolve) => {
      traceDone = resolve;
      send("Tracing.end");
    });
    const total = (name) => traceEvents.filter((e) => e.name === name && e.dur).reduce((s, e) => s + e.dur / 1000, 0);
    return { value, layerizeMs: Math.round(total("Layerize")), paintMs: Math.round(total("Paint")) };
  };
  return { ws, send, evaluate, trace };
}

function processMemory() {
  const out = {};
  let lines;
  try {
    lines = execFileSync("ps", ["-axo", "pid=,rss=,command="]).toString().trim().split("\n");
  } catch {
    return out;
  }
  for (const line of lines) {
    if (!/Electron|PixivBiu|pixivbiu/.test(line) || /desktop-perf-probe/.test(line)) continue;
    const [pid, rss] = line.trim().split(/\s+/, 2);
    const command = line.trim().slice(pid.length + rss.length + 2);
    const type = /--type=(\S+)/.exec(command)?.[1];
    const sub = /--utility-sub-type=([^.\s]+)/.exec(command)?.[1];
    const label = type ? (sub ? `${type}:${sub}` : type) : /-desktop-managed/.test(command) ? "core" : "main";
    if (label === "utility:tracing") continue; // spawned by this probe's own tracing
    let mb = Number(rss) / 1024;
    if (process.platform === "darwin") {
      try {
        const fp = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(execFileSync("footprint", [pid], { stdio: ["ignore", "pipe", "ignore"] }).toString());
        if (fp) mb = Number(fp[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[fp[2]];
      } catch {}
    }
    out[label] = Math.round((out[label] ?? 0) + mb);
  }
  out.total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

const SNAPSHOT = `(() => {
  const all = [...document.querySelectorAll("*")];
  const imgs = [...document.images];
  const style = (e) => getComputedStyle(e);
  return {
    url: location.pathname + location.search,
    domNodes: all.length,
    imgs: imgs.length,
    decodedMB: Math.round(imgs.filter((i) => i.complete).reduce((s, i) => s + i.naturalWidth * i.naturalHeight * 4, 0) / 1048576),
    backdropFilters: all.filter((e) => style(e).backdropFilter !== "none").length,
    filters: all.filter((e) => style(e).filter !== "none").length,
    jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
})()`;

// Programmatic main-thread scroll at a steady speed; records rAF intervals.
const scroll = (ms, step) => `(async () => {
  const sc = document.querySelector("[data-app-scroller]");
  if (!sc) throw new Error("no [data-app-scroller]");
  const deltas = [];
  let last = performance.now();
  const start = last;
  await new Promise((resolve) => {
    const frame = (t) => {
      deltas.push(t - last);
      last = t;
      sc.scrollTop += ${step};
      if (t - start < ${ms}) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
  deltas.shift();
  const sorted = [...deltas].sort((a, b) => a - b);
  const q = (p) => Math.round(sorted[Math.floor(p * (sorted.length - 1))] * 10) / 10;
  return { frames: deltas.length, p50: q(0.5), p95: q(0.95), max: q(1), over25ms: deltas.filter((d) => d > 25).length };
})()`;

// Home feed "load more": the lone button in the row after the illust grid.
const LOAD_MORE_CLICK = `(() => {
  const b = document.querySelector("[data-app-scroller] .grid + div > button:only-child");
  if (!b || b.disabled) return false;
  b.click();
  return true;
})()`;

const SIDEBAR_LINKS = `[...document.querySelectorAll("[data-window-sidebar] nav a[href]")].map((a) => a.getAttribute("href"))`;

const report = { steps: [] };
const record = (label, data) => {
  report.steps.push({ label, ...data });
  if (!JSON_OUT) console.log(label.padEnd(24), JSON.stringify(data));
};

const cdp = await connect();
await cdp.send("Runtime.enable");
record("start memory", processMemory());

const home = await cdp.evaluate(`location.pathname`);
if (home !== "/") console.warn(`Expected to start on Home, found ${home}; Home measurements may be skipped.`);
await cdp.evaluate(`document.querySelector("[data-app-scroller]").scrollTop = 0`);
record("home", await cdp.evaluate(SNAPSHOT));
let loaded = 0;
for (let i = 0; i < LOAD_MORE; i++) {
  await cdp.evaluate(`(() => { const sc = document.querySelector("[data-app-scroller]"); sc.scrollTop = sc.scrollHeight; })()`);
  let clicked = false;
  for (let wait = 0; !clicked && wait < 20; wait++) {
    clicked = await cdp.evaluate(LOAD_MORE_CLICK);
    if (!clicked) await sleep(500);
  }
  if (!clicked) break;
  loaded++;
  await sleep(3000);
}
record("home load more", { requested: LOAD_MORE, loaded });
await cdp.evaluate(`document.querySelector("[data-app-scroller]").scrollTop = 0`);
await sleep(500);
const homeScroll = await cdp.trace(() => cdp.evaluate(scroll(3000, 30)));
record("home scroll", { ...homeScroll.value, layerizeMs: homeScroll.layerizeMs, paintMs: homeScroll.paintMs });
record("home grown", await cdp.evaluate(SNAPSHOT));
record("home memory", processMemory());

for (const href of await cdp.evaluate(SIDEBAR_LINKS)) {
  if (href === "/") continue;
  await cdp.evaluate(`document.querySelector('[data-window-sidebar] nav a[href="${href}"]').click()`);
  await sleep(4000);
  const run = await cdp.trace(() => cdp.evaluate(scroll(1500, 30)));
  record(`visit ${href}`, { ...run.value, layerizeMs: run.layerizeMs });
}
await cdp.evaluate(`document.querySelector('[data-window-sidebar] nav a[href="/"]')?.click()`);
await sleep(2000);
record("after tour", await cdp.evaluate(SNAPSHOT));
record("end memory", processMemory());
cdp.ws.close();
if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
