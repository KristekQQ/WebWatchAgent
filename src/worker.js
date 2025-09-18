// @ts-check
/**
 * Worker: executes a single render request in a Puppeteer page and
 * writes all outputs atomically under responses/<id>/.
 *
 * Design notes:
 * - Uses a long-lived Browser provided by the watcher; this function
 *   creates and disposes a fresh Page per request.
 * - Meta is written first (without finishedAt), then updated upon completion,
 *   ensuring consumers can track progress without partial artifacts.
 * - Any thrown error is captured and reported to both meta.json and done.json.
 */
import path from 'path';
import { writeFileAtomic, writeJSONAtomic, ensureDir } from './files.js';

/**
 * @typedef {Object} RenderRequest
 * @property {string} id
 * @property {"render_url"|"render_html"} op
 * @property {string=} url
 * @property {string=} html
 * @property {{width:number,height:number,deviceScaleFactor?:number}=} viewport
 * @property {boolean=} fullPage
 * @property {import('puppeteer').PuppeteerLifeCycleEvent=} waitUntil
 * @property {number=} timeoutMs
 * @property {string=} userAgent
 * @property {Record<string,string>=} extraHeaders
 * @property {boolean=} screenshot
 * @property {boolean=} htmlOutput
 * @property {number=} postWaitMs
 * @property {Array<PageAction>=} actions
 * @property {string=} sessionId
 * @property {Array<ExtractSpec>=} extract
 * @property {boolean=} captureConsole
 * @property {boolean=} captureNetwork
 * @property {boolean=} screenshotOnEachAction
 */

/**
 * @typedef {(
 *   | { type: 'waitForSelector', selector: string, timeoutMs?: number }
 *   | { type: 'click', selector: string, timeoutMs?: number }
 *   | { type: 'clickAt', x: number, y: number }
 *   | { type: 'waitForTime', ms: number }
 *   | { type: 'waitForFunction', fn: string, timeoutMs?: number }
 *   | { type: 'waitForCanvasPaint', timeoutMs?: number, intervalMs?: number }
 *   | { type: 'muteHeuristic' }
 * )} PageAction
 */

/**
 * @typedef {(
 *   | { type: 'text', selector: string, all?: boolean, name?: string }
 *   | { type: 'attr', selector: string, name: string, all?: boolean, key?: string }
 *   | { type: 'html', selector: string, all?: boolean, name?: string }
 *   | { type: 'exists', selector: string, name?: string }
 * )} ExtractSpec
 */

/**
 * Process a single request with Puppeteer.
 * Writes outputs under responses/<id>/.
 * @param {import('puppeteer').Browser} browser
 * @param {RenderRequest} req
 * @param {string} responsesDir absolute path to responses dir
 */
export async function processRequest(browser, req, responsesDir, context) {
  const id = req.id;
  const outDir = path.join(responsesDir, id);
  await ensureDir(outDir);

  const startedAt = new Date();

  /** @type {{ id:string, op:string, startedAt:string, finishedAt?:string, durationMs?:number, url?:string, viewport?:any, fullPage?:boolean, waitUntil?:string, hadError?:boolean, errorMessage?:string }} */
  const meta = {
    id,
    op: req.op,
    startedAt: startedAt.toISOString(),
    url: req.url,
    viewport: req.viewport,
    fullPage: req.fullPage,
    waitUntil: req.waitUntil,
    hadError: false,
  };

  const metaPath = path.join(outDir, 'meta.json');
  await writeJSONAtomic(metaPath, meta);

  let errorMessage = undefined;
  let page;
  /** @type {Array<any>} */
  const consoleEvents = [];
  /** @type {Array<any>} */
  const networkEvents = [];
  try {
    // One fresh page per request; optionally reuse a BrowserContext via sessionId.
    page = context ? await context.newPage() : await browser.newPage();

    // Optional capture of console and network events for diagnostics
    if (req.captureConsole) {
      page.on('console', (msg) => {
        consoleEvents.push({
          type: msg.type(),
          text: msg.text(),
          ts: Date.now(),
        });
      });
    }
    if (req.captureNetwork) {
      page.on('request', (req) => {
        networkEvents.push({ phase: 'request', url: req.url(), method: req.method(), ts: Date.now() });
      });
      page.on('response', async (res) => {
        let status = 0; let url = '';
        try { status = res.status(); url = res.url(); } catch {}
        networkEvents.push({ phase: 'response', url, status, ts: Date.now() });
      });
    }

    if (req.userAgent) {
      await page.setUserAgent(req.userAgent);
    }
    if (req.extraHeaders && Object.keys(req.extraHeaders).length > 0) {
      await page.setExtraHTTPHeaders(req.extraHeaders);
    }

    const viewport = req.viewport || { width: 1280, height: 800, deviceScaleFactor: 1 };
    await page.setViewport(viewport);
    const timeoutMs = req.timeoutMs ?? 30000;
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);

    const waitUntil = /** @type {import('puppeteer').PuppeteerLifeCycleEvent} */ (req.waitUntil || 'networkidle2');

    if (req.op === 'render_url') {
      if (!req.url) throw new Error('url is required for op=render_url');
      await page.goto(req.url, { waitUntil, timeout: timeoutMs });
    } else if (req.op === 'render_html') {
      if (!req.html) throw new Error('html is required for op=render_html');
      await page.setContent(req.html, { waitUntil, timeout: timeoutMs });
    } else {
      throw new Error(`Unknown op: ${req.op}`);
    }

    // Optional extra wait after load
    if (req.postWaitMs && req.postWaitMs > 0) {
      await new Promise((r) => setTimeout(r, Math.min(req.postWaitMs, 5 * 60_000)));
    }

    // Run scripted actions if provided (e.g., mute click, canvas wait, etc.)
    if (Array.isArray(req.actions) && req.actions.length > 0) {
      await runActions(page, req.actions, outDir, !!req.screenshotOnEachAction);
    }

    // Output after actions
    if (req.htmlOutput) {
      const html = await page.content();
      await writeFileAtomic(path.join(outDir, 'page.html'), html);
    }

    if (req.screenshot) {
      await page.screenshot({ path: path.join(outDir, 'screenshot.png'), fullPage: !!req.fullPage });
    }

    // Extract requested data
    if (Array.isArray(req.extract) && req.extract.length > 0) {
      const extracted = await performExtracts(page, req.extract);
      await writeFileAtomic(path.join(outDir, 'extract.json'), JSON.stringify(extracted, null, 2));
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    // Always close the page to avoid leaks, even on error
    try { await page?.close(); } catch {}
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  meta.finishedAt = finishedAt.toISOString();
  meta.durationMs = durationMs;
  if (errorMessage) {
    meta.hadError = true;
    meta.errorMessage = errorMessage;
  }
  await writeJSONAtomic(metaPath, meta);

  const donePath = path.join(outDir, 'done.json');
  // Write captured logs (best-effort)
  try {
    if (consoleEvents.length > 0) await writeFileAtomic(path.join(outDir, 'console.log.json'), JSON.stringify(consoleEvents, null, 2));
    if (networkEvents.length > 0) await writeFileAtomic(path.join(outDir, 'network.log.json'), JSON.stringify(networkEvents, null, 2));
  } catch {}
  if (errorMessage) {
    await writeJSONAtomic(donePath, { status: 'error', error: errorMessage });
    throw new Error(errorMessage);
  } else {
    await writeJSONAtomic(donePath, { status: 'ok' });
  }
}

/**
 * Execute a list of simple actions on the page.
 *
 * Tips:
 * - Prefer selector-based actions where possible; use clickAt for canvas-only UIs.
 * - Use waitForCanvasPaint when the game paints into a canvas and has no stable DOM.
 *
 * @param {import('puppeteer').Page} page Puppeteer page instance.
 * @param {Array<PageAction>} actions Sequence of actions to execute.
 * @param {string} outDir Output directory for optional step screenshots.
 * @param {boolean} snapAfterEach If true, capture a screenshot after each action.
 */
async function runActions(page, actions, outDir, snapAfterEach) {
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const type = a?.type;
    try {
      if (type === 'waitForSelector' && a.selector) {
        await page.waitForSelector(a.selector, { timeout: a.timeoutMs ?? 30000 });
      } else if (type === 'click' && a.selector) {
        await page.waitForSelector(a.selector, { timeout: a.timeoutMs ?? 30000 });
        await page.click(a.selector);
      } else if (type === 'hover' && a.selector) {
        await page.waitForSelector(a.selector, { timeout: a.timeoutMs ?? 30000 });
        await page.hover(a.selector);
      } else if (type === 'type' && a.selector && typeof a.text === 'string') {
        await page.waitForSelector(a.selector, { timeout: a.timeoutMs ?? 30000 });
        await page.type(a.selector, a.text, { delay: a.delay ?? 0 });
      } else if (type === 'clickAt' && typeof a.x === 'number' && typeof a.y === 'number') {
        await page.mouse.click(a.x, a.y);
      } else if (type === 'waitForTime' && typeof a.ms === 'number') {
        await new Promise((r) => setTimeout(r, a.ms));
      } else if (type === 'waitForFunction' && a.fn) {
        await page.waitForFunction(a.fn, { timeout: a.timeoutMs ?? 30000 });
      } else if (type === 'waitForCanvasPaint') {
        await waitForCanvasPaint(page, a.timeoutMs ?? 60000, a.intervalMs ?? 500);
      } else if (type === 'muteHeuristic') {
        await clickMuteHeuristic(page);
      } else if (type === 'screenshotElement' && a.selector) {
        const el = await page.waitForSelector(a.selector, { timeout: a.timeoutMs ?? 30000 });
        if (el) {
          const file = a.file || `step-${String(i + 1).padStart(2, '0')}-element.png`;
          await el.screenshot({ path: path.join(outDir, file) });
        }
      } else if (type === 'press' && a.key) {
        await page.keyboard.press(a.key, { delay: a.delay ?? 0 });
      }
      if (snapAfterEach) {
        const fname = `step-${String(i + 1).padStart(2, '0')}.png`;
        await page.screenshot({ path: path.join(outDir, fname), fullPage: true });
      }
    } catch (e) {
      // Fail fast: surface the error in meta/done and stop further actions
      throw e;
    }
  }
}

/**
 * Try to detect and click a "no sounds/mute" UI element heuristically.
 * Heuristic: scan buttons-like elements for text tokens related to
 * sound/audio/music and negative modifiers (no/off/mute/bez/vyp...).
 * Best-effort; safe if not found.
 * @param {import('puppeteer').Page} page Puppeteer page.
 */
async function clickMuteHeuristic(page) {
  // Strategy: find buttons/links/divs with text containing sound/audio/music/zvuk/hudba and also no/off/mute/disable/bez/vyp
  const selector = await page.evaluate(() => {
    const score = (el) => {
      const t = (el.innerText || el.textContent || '').toLowerCase();
      let s = 0;
      if (/sound|audio|music|zvuk|zvuky|hudba/.test(t)) s += 2;
      if (/no|off|mute|disable|bez|vyp/.test(t)) s += 3;
      if (/accept|ok|yes|ano/.test(t)) s -= 1; // avoid clicking accept
      return s;
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, .btn'));
    let best = null;
    let bestScore = 0;
    for (const el of candidates) {
      const s = score(el);
      if (s > bestScore) { bestScore = s; best = el; }
    }
    if (best && bestScore >= 3) {
      best.setAttribute('data-ww-click', '1');
      return '[data-ww-click="1"]';
    }
    return null;
  });
  if (selector) {
    await page.click(selector);
  }
}

/**
 * Wait until a canvas appears and seems to have non-blank pixels (best-effort).
 * For WebGL-only canvases or tainted contexts, we assume rendered content once present.
 * @param {import('puppeteer').Page} page Puppeteer page.
 * @param {number} timeoutMs Max time to wait in milliseconds.
 * @param {number} intervalMs Polling interval in milliseconds.
 */
async function waitForCanvasPaint(page, timeoutMs, intervalMs) {
  const t0 = Date.now();
  for (;;) {
    const painted = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return false;
      try {
        const ctx = c.getContext('2d');
        if (!ctx) return true; // WebGL only; assume painted once present
        const w = Math.min(64, c.width);
        const h = Math.min(64, c.height);
        const img = ctx.getImageData(0, 0, w, h).data;
        for (let i = 0; i < img.length; i += 4) {
          const r = img[i], g = img[i+1], b = img[i+2], a = img[i+3];
          if (a !== 0 && !(r === 255 && g === 255 && b === 255)) return true;
        }
        return false;
      } catch {
        return true; // Tainted canvas — assume painted
      }
    });
    if (painted) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('waitForCanvasPaint timeout');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Extract data from the page based on provided specs.
 * Returns an array of extraction results in the same order as specs.
 * @param {import('puppeteer').Page} page
 * @param {Array<ExtractSpec>} specs
 */
async function performExtracts(page, specs) {
  /** @type {Array<any>} */
  const results = [];
  for (const s of specs) {
    const type = s.type;
    if (type === 'text') {
      const { selector, all } = s;
      const value = await page.evaluate(({ selector, all }) => {
        const els = Array.from(document.querySelectorAll(selector));
        if (all) return els.map((e) => (e.textContent || '').trim());
        const el = els[0];
        return el ? (el.textContent || '').trim() : null;
      }, { selector, all: !!all });
      results.push({ type, name: s.name, selector, value });
    } else if (type === 'attr') {
      const { selector, name, all } = s;
      const value = await page.evaluate(({ selector, name, all }) => {
        const els = Array.from(document.querySelectorAll(selector));
        if (all) return els.map((e) => e.getAttribute(name));
        const el = els[0];
        return el ? el.getAttribute(name) : null;
      }, { selector, name, all: !!all });
      results.push({ type, key: s.key || name, selector, value });
    } else if (type === 'html') {
      const { selector, all } = s;
      const value = await page.evaluate(({ selector, all }) => {
        const els = Array.from(document.querySelectorAll(selector));
        if (all) return els.map((e) => e.outerHTML);
        const el = els[0];
        return el ? el.outerHTML : null;
      }, { selector, all: !!all });
      results.push({ type, name: s.name, selector, value });
    } else if (type === 'exists') {
      const { selector } = s;
      const value = await page.evaluate((selector) => !!document.querySelector(selector), selector);
      results.push({ type, name: s.name, selector, value });
    }
  }
  return results;
}
