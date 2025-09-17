# Web Watcher — Agent Notes (Read Me First)

This repo runs a local headless web renderer for agents. It lets you load a URL or raw HTML, wait, perform clicks/steps, and retrieve HTML and screenshots via filesystem IPC. Use it to answer “what do I see on this page?”, to click through first‑run modals (e.g., mute/continue), or to capture stable views for analysis.

Scope of this file: whole repo.

## TL;DR
- Start service: `npm i && npm run dev`.
- Drop JSON requests into `requests/`. Results appear in `responses/<id>/`.
- Or use the client helper from Node: `renderURL()` / `renderHTML()`.
- Single browser instance; tasks processed sequentially by default (`CONCURRENCY=1`).

## Folders
- `requests/` — write one JSON request per job.
- `requests/processing/` — claimed requests (internal; do not write here).
- `responses/<id>/` — outputs: `meta.json`, `page.html`, `screenshot.png`, `done.json`.

## Request Schema (v1)
```
{
  "id": "optional string; UUID if missing",
  "op": "render_url | render_html",
  "url": "https://... (required for render_url)",
  "html": "<html>...</html> (required for render_html)",
  "viewport": { "width": 1280, "height": 800, "deviceScaleFactor": 1 },
  "fullPage": true,
  "waitUntil": "load | domcontentloaded | networkidle0 | networkidle2",
  "timeoutMs": 30000,
  "userAgent": "optional",
  "extraHeaders": { "X-Example": "42" },
  "screenshot": true,
  "htmlOutput": true,
  "postWaitMs": 0,
  "actions": [ /* see Action DSL */ ]
}
```

## Action DSL (what you can do during a render)
- `{ "type": "waitForSelector", "selector": "CSS", "timeoutMs"?: number }`
- `{ "type": "click", "selector": "CSS", "timeoutMs"?: number }`
- `{ "type": "clickAt", "x": number, "y": number }`  (for canvas/hotspots)
- `{ "type": "waitForTime", "ms": number }`           (simple delay)
- `{ "type": "waitForFunction", "fn": "JS expression", "timeoutMs"?: number }`
- `{ "type": "waitForCanvasPaint", "timeoutMs"?: number, "intervalMs"?: number }`
- `{ "type": "muteHeuristic" }`  (best‑effort click on a mute/no‑sound control)

Notes
- Use selector‑based actions when possible; prefer `click` over `clickAt`.
- For canvas games, start with `waitForCanvasPaint`, then `clickAt` as needed.
- `postWaitMs` adds extra time after navigation/content load and before actions.

## Outputs per job (responses/<id>/)
- `meta.json`: `{ id, op, startedAt, finishedAt, durationMs, url, viewport, fullPage, waitUntil, hadError, errorMessage }`
- `page.html`: HTML after actions (if `htmlOutput: true`).
- `screenshot.png`: full‑page screenshot (if `screenshot: true`).
- `done.json`: `{ status: "ok" }` or `{ status: "error", error }` (written last).

## Client Helper (Node ESM)
```
import { renderURL, renderHTML } from "./client/codex-webviz-client.js";

// Example: load a canvas game, wait, try to mute, click a few times
const job = await renderURL("http://host/app", {
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  waitUntil: "networkidle2",
  timeoutMs: 150000,
  postWaitMs: 60000,
  actions: [
    { type: "waitForCanvasPaint", timeoutMs: 60000 },
    { type: "muteHeuristic" },
    { type: "waitForTime", ms: 1500 },
    { type: "clickAt", x: 640, y: 360 },
  ],
  screenshot: true,
  htmlOutput: true,
  clientTimeoutMs: 240000
});

console.log(job.paths.screenshot); // what you “see”
```

## Recipes (useful patterns)
- “What does the page look like?” → `renderURL(url, { screenshot: true, htmlOutput: true })`.
- Slow apps/games → bump `timeoutMs` (nav), add `postWaitMs`, then `waitForCanvasPaint`.
- Dismiss sound/consent dialogs → `muteHeuristic` then `click` on a known selector or `clickAt` center.
- Multi‑step flows → split into multiple jobs for clearer checkpoints and faster retries.

## Operational Notes
- Start watcher: `npm run dev` (env: `CONCURRENCY=1` default).
- Browser flags: WebGL enabled with SwiftShader; runs headless.
- Writes are atomic (temp file then rename) to avoid partial reads by clients.
- Graceful shutdown on SIGINT/SIGTERM: finishes current task and closes browser.

## Do / Don’t (for agents)
- Do: keep requests minimal and deterministic; add explicit waits when UI is async.
- Do: read `meta.json` for timing/errors; use it to tune waits.
- Don’t: write into `requests/processing/` yourself.
- Don’t: assume DOM exists for canvas‑only UIs; prefer `clickAt` there.

## Troubleshooting
- Blank screenshots on canvas apps → add `waitForCanvasPaint` or longer `postWaitMs`.
- Timeouts → raise `timeoutMs` and client‑side `clientTimeoutMs`.
- Blocked by headless detection → set `userAgent`, add `extraHeaders`, or consider running non‑headless locally (code change required).

## Future Extensions (nice to have)
- `extract`: declarative selectors to save text/attrs to `extract.json`.
- `screenshotElement(selector)`: crop a specific element.
- `sessionId`: multi‑step flows in a single persistent page.
- Console/network capture: write `console.log.json` / `network.log.json` for debugging.

Stay within this API unless you’re explicitly extending it; keep the file watcher simple and outputs atomic.
