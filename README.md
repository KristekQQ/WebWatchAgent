# Web Watcher (Puppeteer + Filesystem IPC)

Local Web Watcher service that accepts render requests via filesystem, renders web content with Puppeteer, and writes HTML and PNG outputs. Includes a tiny client helper that Codex (or any Node.js script) can call to submit jobs and await completion.

## Features

- Headless rendering of URLs and raw HTML strings
- Outputs: `page.content()` to `page.html` and full-page `screenshot.png`
- Filesystem-based IPC: drop JSON into `requests/`, read results in `responses/<id>/`
- Single long-living browser instance, concurrency-limited processing (default 1)
- Robust error handling and atomic writes

## Requirements

- Node.js >= 18

## Install

```
npm i
npm run dev
```

On first run, the service auto-creates `requests/` and `responses/`.

## How It Works (IPC)

- Write a JSON request file into `requests/` (filename can be anything)
- Watcher picks it up, moves it to `requests/processing/<id>.json`
- Processing outputs are written to `responses/<id>/`:
  - `meta.json` — metadata and timings
  - `page.html` — saved HTML (if requested)
  - `screenshot.png` — full-page PNG (if requested)
  - `done.json` — `{ "status": "ok" | "error", "error": "..." }` (written last)

Request JSON schema:

```
{
  "id": "optional string id; if missing, watcher generates UUID",
  "op": "render_url | render_html",
  "url": "https://example.com (required for op=render_url)",
  "html": "<html>…</html> (required for op=render_html)",
  "viewport": { "width": 1280, "height": 800, "deviceScaleFactor": 1 },
  "fullPage": true,
  "waitUntil": "networkidle2",
  "timeoutMs": 30000,
  "userAgent": "optional UA string",
  "extraHeaders": { "X-Example": "42" },
  "screenshot": true,
  "htmlOutput": true,
  "postWaitMs": 0,
  "sessionId": "optional persistent context id",
  "captureConsole": false,
  "captureNetwork": false,
  "screenshotOnEachAction": false,
  "actions": [
    { "type": "waitForSelector", "selector": "#start" },
    { "type": "click", "selector": "button.mute" },
    { "type": "clickAt", "x": 640, "y": 360 },
    { "type": "waitForTime", "ms": 5000 },
    { "type": "waitForFunction", "fn": "document.querySelector('canvas') != null" },
    { "type": "waitForCanvasPaint", "timeoutMs": 60000 },
    { "type": "muteHeuristic" },
    { "type": "hover", "selector": "#btn" },
    { "type": "type", "selector": "#input", "text": "hello", "delay": 20 },
    { "type": "press", "key": "Enter" },
    { "type": "screenshotElement", "selector": "#panel", "file": "panel.png" }
  ]
}
```

## Run the watcher

```
npm run dev
```

Environment variables:

- `CONCURRENCY` — max concurrent renders (default `1`)

## Submit jobs programmatically (client helper)

```js
import { renderURL, renderHTML } from "./client/codex-webviz-client.js";

const main = async () => {
  const r1 = await renderURL("https://example.com", { screenshot: true, htmlOutput: true });
  console.log("URL render done:", r1);

  const r2 = await renderHTML("<html><body><h1>Ahoj!</h1></body></html>", { screenshot: true, htmlOutput: true });
  console.log("HTML render done:", r2);
};

main().catch(console.error);
```

An equivalent example is provided at `examples/usage.js`.

Return shape:

```
{
  id: string,
  paths: {
    meta: "responses/<id>/meta.json",
    html: "responses/<id>/page.html",
    screenshot: "responses/<id>/screenshot.png"
  },
  done: { status: "ok" } | { status: "error", error: string }
}
```

If `done.status === "error"`, the helper throws an `Error` whose message mirrors the server-side meta.

## Submit jobs via raw JSON files

1. Create a request file in `requests/` using the schema above.
2. Watcher will move it to `requests/processing/<id>.json`.
3. Collect results from `responses/<id>/`.

Examples:

- `examples/example-url.json`
- `examples/example-html.json`

### Příklad pro delší načtení a kliknutí na „bez zvuku“

```json
{
  "op": "render_url",
  "url": "http://<vaše-ip>:4000/casino-games/?...",
  "timeoutMs": 120000,
  "postWaitMs": 60000,
  "actions": [
    { "type": "waitForCanvasPaint", "timeoutMs": 60000 },
    { "type": "muteHeuristic" }
  ],
  "screenshot": true,
  "htmlOutput": true
}
```

## Troubleshooting

- Puppeteer download: On first install, Puppeteer downloads a Chromium. Ensure network permissions and disk space.
- Permissions: The watcher writes under `responses/` and reads from `requests/`. Ensure your user can read/write these folders.
- Timeouts: Increase `timeoutMs` in the request if pages load slowly. The client has its own `clientTimeoutMs` (defaults to request timeout + 30s, min 60s).
- Headless issues: Some sites block headless browsers. Try customizing `userAgent` or adding `extraHeaders`.
- Concurrency: Default is `1` for stability. Increase with `CONCURRENCY=2 npm run dev` cautiously.

## Scripts

- `npm run dev` — start the watcher (same as `start`)
- `npm run start` — start the watcher
- `npm run clean` — clear `requests/` and `responses/` contents (keeps folders)
- `npm run submit` — CLI to submit a job (`ww-submit`)

### CLI quickstart

```
# URL mode
ww-submit url https://example.com --timeout 60000 --post-wait 2000 --screenshot --html

# HTML mode
ww-submit html ./examples/sample.html --wait-until networkidle2 --timeout 45000

# With actions and extract specs from files
ww-submit url http://host/app \
  --actions ./actions.json \
  --extract ./extract.json \
  --console --network --steps --client-timeout 180000
```
### Extract structured data (optional)

Add an `extract` array to the request to save `responses/<id>/extract.json`:

```
"extract": [
  { "type": "text", "selector": "h1" },
  { "type": "attr", "selector": "img.logo", "name": "src" },
  { "type": "exists", "selector": "#consent-accept" }
]
```

### Persistent session (optional)

Provide `sessionId` to persist cookies/localStorage across multiple requests. Each job still uses a fresh page, but shares the same incognito browser context.
