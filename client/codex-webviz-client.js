// @ts-check
/**
 * Minimal client helper for submitting render requests to the Web Watcher
 * via filesystem IPC and awaiting completion.
 *
 * Usage (ESM):
 *   import { renderURL, renderHTML } from "./client/codex-webviz-client.js";
 *   const job = await renderURL("https://example.com", { screenshot: true });
 *
 * The helper writes a JSON request into requests/<id>.json and then polls for
 * responses/<id>/done.json. When finished, it returns convenient file paths.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const REQUESTS_DIR = path.resolve(process.cwd(), 'requests');
const RESPONSES_DIR = path.resolve(process.cwd(), 'responses');

/** Sleep helper */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Atomically write a file by writing to a temp file then renaming.
 * @param {string} filePath Destination path of the final file.
 * @param {string|Uint8Array} data File contents.
 */
async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp-${uuidv4()}`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

/**
 * Wait for responses/<id>/done.json with an optional timeout.
 * @param {string} id Request ID.
 * @param {number} timeoutMs Maximum time to wait.
 * @param {number} pollIntervalMs Polling interval.
 */
async function waitForDone(id, timeoutMs, pollIntervalMs) {
  const donePath = path.join(RESPONSES_DIR, id, 'done.json');
  const t0 = Date.now();
  while (true) {
    try {
      const data = await fs.readFile(donePath, 'utf8');
      return JSON.parse(data);
    } catch {}
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`Timeout waiting for ${path.relative(process.cwd(), donePath)}`);
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Submit a render URL request and await completion.
 * @param {string} url Target URL to navigate to.
 * @param {Partial<{ id:string, viewport:{width:number,height:number,deviceScaleFactor?:number}, fullPage:boolean, waitUntil:string, timeoutMs:number, userAgent:string, extraHeaders:Record<string,string>, screenshot:boolean, htmlOutput:boolean, postWaitMs:number, actions:any[], clientTimeoutMs:number, pollIntervalMs:number }>} opts Options controlling rendering and client wait.
 * @returns {Promise<{ id:string, paths:{ meta:string, html:string, screenshot:string }, done:any }>} Resolved with paths to outputs.
 */
export async function renderURL(url, opts = {}) {
  const id = opts.id || uuidv4();
  const req = {
    id,
    op: 'render_url',
    url,
    viewport: opts.viewport,
    fullPage: opts.fullPage,
    waitUntil: opts.waitUntil,
    timeoutMs: opts.timeoutMs,
    userAgent: opts.userAgent,
    extraHeaders: opts.extraHeaders,
    screenshot: opts.screenshot ?? true,
    htmlOutput: opts.htmlOutput ?? true,
    postWaitMs: opts.postWaitMs,
    actions: opts.actions,
  };
  const reqPath = path.join(REQUESTS_DIR, `${id}.json`);
  await writeFileAtomic(reqPath, JSON.stringify(req, null, 2));

  const clientTimeoutMs = opts.clientTimeoutMs ?? Math.max(60000, (opts.timeoutMs ?? 30000) + 30000);
  const pollIntervalMs = opts.pollIntervalMs ?? 300;
  const done = await waitForDone(id, clientTimeoutMs, pollIntervalMs);

  const metaPath = path.join(RESPONSES_DIR, id, 'meta.json');
  const htmlPath = path.join(RESPONSES_DIR, id, 'page.html');
  const screenshotPath = path.join(RESPONSES_DIR, id, 'screenshot.png');

  if (done?.status === 'error') {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      throw new Error(meta?.errorMessage || done.error || 'Unknown error');
    } catch {
      throw new Error(done.error || 'Unknown error');
    }
  }

  return { id, paths: { meta: metaPath, html: htmlPath, screenshot: screenshotPath }, done };
}

/**
 * Submit a render HTML request and await completion.
 * @param {string} html HTML string to render in a blank page.
 * @param {Partial<{ id:string, viewport:{width:number,height:number,deviceScaleFactor?:number}, fullPage:boolean, waitUntil:string, timeoutMs:number, userAgent:string, extraHeaders:Record<string,string>, screenshot:boolean, htmlOutput:boolean, postWaitMs:number, actions:any[], clientTimeoutMs:number, pollIntervalMs:number }>} opts Options controlling rendering and client wait.
 * @returns {Promise<{ id:string, paths:{ meta:string, html:string, screenshot:string }, done:any }>} Resolved with paths to outputs.
 */
export async function renderHTML(html, opts = {}) {
  const id = opts.id || uuidv4();
  const req = {
    id,
    op: 'render_html',
    html,
    viewport: opts.viewport,
    fullPage: opts.fullPage,
    waitUntil: opts.waitUntil,
    timeoutMs: opts.timeoutMs,
    userAgent: opts.userAgent,
    extraHeaders: opts.extraHeaders,
    screenshot: opts.screenshot ?? true,
    htmlOutput: opts.htmlOutput ?? true,
    postWaitMs: opts.postWaitMs,
    actions: opts.actions,
  };
  const reqPath = path.join(REQUESTS_DIR, `${id}.json`);
  await writeFileAtomic(reqPath, JSON.stringify(req, null, 2));

  const clientTimeoutMs = opts.clientTimeoutMs ?? Math.max(60000, (opts.timeoutMs ?? 30000) + 30000);
  const pollIntervalMs = opts.pollIntervalMs ?? 300;
  const done = await waitForDone(id, clientTimeoutMs, pollIntervalMs);

  const metaPath = path.join(RESPONSES_DIR, id, 'meta.json');
  const htmlPath = path.join(RESPONSES_DIR, id, 'page.html');
  const screenshotPath = path.join(RESPONSES_DIR, id, 'screenshot.png');

  if (done?.status === 'error') {
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      throw new Error(meta?.errorMessage || done.error || 'Unknown error');
    } catch {
      throw new Error(done.error || 'Unknown error');
    }
  }

  return { id, paths: { meta: metaPath, html: htmlPath, screenshot: screenshotPath }, done };
}
