// @ts-check
/**
 * Watcher: watches the requests/ folder for JSON requests, serializes
 * their execution via an in-memory queue, and delegates to the worker.
 *
 * Responsibilities:
 * - Maintain a single long-lived Puppeteer browser.
 * - Claim request files (move to requests/processing/<id>.json) to avoid double processing.
 * - Normalize/validate request fields and apply safe defaults.
 * - Ensure all outputs are written atomically under responses/<id>/.
 * - Log concise status lines and shut down gracefully on SIGINT/SIGTERM.
 */
import path from 'path';
import { promises as fs } from 'fs';
import chokidar from 'chokidar';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import { ensureDir, readJSON, writeJSONAtomic } from './files.js';
import { processRequest } from './worker.js';

const REQUESTS_DIR = path.resolve(process.cwd(), 'requests');
const PROCESSING_DIR = path.join(REQUESTS_DIR, 'processing');
const RESPONSES_DIR = path.resolve(process.cwd(), 'responses');

/** Concurrency limit (default 1) */
const CONCURRENCY = Math.max(1, parseInt(process.env.CONCURRENCY || '1', 10));

async function setupDirs() {
  await ensureDir(REQUESTS_DIR);
  await ensureDir(PROCESSING_DIR);
  await ensureDir(RESPONSES_DIR);
}

/**
 * Minimal in-memory limiter (p-limit style) to cap concurrent tasks.
 * @param {number} limit Max concurrent executions.
 * @returns {(fn: () => Promise<void>) => Promise<void>} Enqueue function.
 */
function createLimiter(limit) {
  let active = 0;
  /** @type {Array<{fn:()=>Promise<void>, resolve:Function, reject:Function}>} */
  const queue = [];

  const runNext = () => {
    if (active >= limit) return;
    const item = queue.shift();
    if (!item) return;
    active++;
    item.fn()
      .then(() => item.resolve())
      .catch((e) => item.reject(e))
      .finally(() => {
        active--;
        setImmediate(runNext);
      });
  };

  return function enqueue(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      setImmediate(runNext);
    });
  };
}

/**
 * Normalize and validate a raw request object from JSON.
 * Applies sensible defaults and strong typing where practical.
 * @param {any} raw Untrusted raw JSON from a request file.
 */
function normalizeRequest(raw) {
  const id = String(raw.id || uuidv4());
  const op = raw.op;
  if (op !== 'render_url' && op !== 'render_html') {
    throw new Error('op must be "render_url" or "render_html"');
  }
  if (op === 'render_url' && !raw.url) throw new Error('url is required for op=render_url');
  if (op === 'render_html' && !raw.html) throw new Error('html is required for op=render_html');

  const viewport = raw.viewport || { width: 1280, height: 800, deviceScaleFactor: 1 };
  const fullPage = raw.fullPage !== undefined ? !!raw.fullPage : true;
  const waitUntil = raw.waitUntil || 'networkidle2';
  const timeoutMs = raw.timeoutMs ?? 30000;
  const userAgent = raw.userAgent;
  const extraHeaders = raw.extraHeaders;
  const screenshot = raw.screenshot !== undefined ? !!raw.screenshot : true;
  const htmlOutput = raw.htmlOutput !== undefined ? !!raw.htmlOutput : true;

  const postWaitMs = raw.postWaitMs;
  const actions = Array.isArray(raw.actions) ? raw.actions : undefined;
  const sessionId = raw.sessionId ? String(raw.sessionId) : undefined;
  const extract = Array.isArray(raw.extract) ? raw.extract : undefined;
  const captureConsole = !!raw.captureConsole;
  const captureNetwork = !!raw.captureNetwork;
  const screenshotOnEachAction = !!raw.screenshotOnEachAction;

  return { id, op, url: raw.url, html: raw.html, viewport, fullPage, waitUntil, timeoutMs, userAgent, extraHeaders, screenshot, htmlOutput, postWaitMs, actions, sessionId, extract, captureConsole, captureNetwork, screenshotOnEachAction };
}

/** Entry point: start browser, wire up watcher, and handle shutdown. */
async function main() {
  await setupDirs();

  const enqueue = createLimiter(CONCURRENCY);
  let shuttingDown = false;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox'
    ],
  });

  /** @type {Map<string, import('puppeteer').BrowserContext>} */
  const sessionContexts = new Map();

  const watcher = chokidar.watch(path.join(REQUESTS_DIR, '*.json'), {
    ignoreInitial: false,
    ignored: [/(^|[/\\])\../],
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 0,
    usePolling: true,
    interval: 200,
  });

  const stop = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[INF] Shutdown requested. Closing watcher...');
    try { await watcher.close(); } catch {}
    // Wait briefly for in-flight tasks; limiter will finish queued tasks naturally
    console.log('[INF] Closing browser...');
    try { await browser.close(); } catch {}
    console.log('[INF] Bye.');
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  watcher.on('add', async (filePath) => {
    if (shuttingDown) return;
    // Attempt to read, normalize, then move to processing/<id>.json to claim
    try {
      const raw = await readJSON(filePath);
      const req = normalizeRequest(raw);
      const claimedPath = path.join(PROCESSING_DIR, `${req.id}.json`);
      try {
        await fs.rename(filePath, claimedPath);
      } catch (e) {
        // If rename fails because the file vanished, ignore
      }

      console.log(`[START] id=${req.id} op=${req.op} ${req.url ? `url=${req.url}` : ''}`.trim());

      await enqueue(async () => {
        const t0 = Date.now();
        try {
          let context = undefined;
          if (req.sessionId) {
            context = sessionContexts.get(req.sessionId);
            if (!context) {
              context = await browser.createIncognitoBrowserContext();
              sessionContexts.set(req.sessionId, context);
            }
          }
          await processRequest(browser, req, RESPONSES_DIR, context);
          const dt = Date.now() - t0;
          console.log(`[OK] id=${req.id} in ${dt}ms`);
        } catch (err) {
          const dt = Date.now() - t0;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ERR] id=${req.id} in ${dt}ms: ${msg}`);
        } finally {
          try { await fs.unlink(claimedPath); } catch {}
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ERR] Failed to handle request file ${path.basename(filePath)}: ${msg}`);
      // Try to write an error response if we can parse an id
      try {
        const raw = await readJSON(filePath).catch(() => ({}));
        const id = raw?.id || uuidv4();
        const outDir = path.join(RESPONSES_DIR, id);
        await ensureDir(outDir);
        const startedAt = new Date().toISOString();
        await writeJSONAtomic(path.join(outDir, 'meta.json'), {
          id,
          op: raw?.op,
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: 0,
          url: raw?.url,
          viewport: raw?.viewport,
          fullPage: raw?.fullPage,
          waitUntil: raw?.waitUntil,
          hadError: true,
          errorMessage: msg,
        });
        await writeJSONAtomic(path.join(outDir, 'done.json'), { status: 'error', error: msg });
      } catch {}
      try { await fs.unlink(filePath); } catch {}
    }
  });

  console.log(`[INF] Web Watcher started. Watching ${path.join('requests', '*.json')} (concurrency=${CONCURRENCY}).`);
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
