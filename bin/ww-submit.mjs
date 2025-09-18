#!/usr/bin/env node
// @ts-check
/**
 * Minimal CLI to submit Web Watcher jobs from the terminal.
 * Examples:
 *   ww-submit url https://example.com --timeout 60000 --post-wait 5000 --screenshot --html
 *   ww-submit url http://host/app --actions actions.json --extract extract.json --console --network
 *   ww-submit html ./page.html --wait-until networkidle2
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clientPath = path.resolve(__dirname, '../client/codex-webviz-client.js');
const { renderURL, renderHTML } = await import(clientPath);

function parseFlags(argv) {
  /** @type {Record<string, any>} */
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--timeout') flags.timeoutMs = Number(argv[++i]);
    else if (a === '--post-wait') flags.postWaitMs = Number(argv[++i]);
    else if (a === '--wait-until') flags.waitUntil = argv[++i];
    else if (a === '--screenshot') flags.screenshot = true;
    else if (a === '--no-screenshot') flags.screenshot = false;
    else if (a === '--html') flags.htmlOutput = true;
    else if (a === '--no-html') flags.htmlOutput = false;
    else if (a === '--actions') flags.actionsFile = argv[++i];
    else if (a === '--extract') flags.extractFile = argv[++i];
    else if (a === '--console') flags.captureConsole = true;
    else if (a === '--network') flags.captureNetwork = true;
    else if (a === '--steps') flags.screenshotOnEachAction = true;
    else if (a === '--session') flags.sessionId = argv[++i];
    else if (a === '--ua') flags.userAgent = argv[++i];
    else if (a === '--headers') flags.headersFile = argv[++i];
    else if (a === '--client-timeout') flags.clientTimeoutMs = Number(argv[++i]);
    else if (a === '--viewport') {
      const [w, h, d = '1'] = String(argv[++i]).split('x');
      flags.viewport = { width: Number(w), height: Number(h), deviceScaleFactor: Number(d) };
    } else rest.push(a);
  }
  return { flags, rest };
}

async function loadJSONMaybe(p) {
  if (!p) return undefined;
  const abs = path.resolve(process.cwd(), p);
  return JSON.parse(await fs.readFile(abs, 'utf8'));
}

async function main() {
  const [,, cmd, arg1, ...restArgs] = process.argv;
  if (!cmd || (cmd !== 'url' && cmd !== 'html')) {
    console.error('Usage: ww-submit url <URL> [flags] | ww-submit html <FILE> [flags]');
    process.exit(2);
  }
  const { flags } = parseFlags(restArgs);
  const actions = await loadJSONMaybe(flags.actionsFile);
  const extract = await loadJSONMaybe(flags.extractFile);
  const extraHeaders = await loadJSONMaybe(flags.headersFile);

  const opts = {
    timeoutMs: flags.timeoutMs,
    postWaitMs: flags.postWaitMs,
    waitUntil: flags.waitUntil,
    screenshot: flags.screenshot,
    htmlOutput: flags.htmlOutput,
    actions: actions,
    extract: extract,
    captureConsole: flags.captureConsole,
    captureNetwork: flags.captureNetwork,
    screenshotOnEachAction: flags.screenshotOnEachAction,
    sessionId: flags.sessionId,
    userAgent: flags.userAgent,
    extraHeaders,
    clientTimeoutMs: flags.clientTimeoutMs,
    viewport: flags.viewport,
  };

  let res;
  if (cmd === 'url') {
    if (!arg1) { console.error('Missing <URL>'); process.exit(2); }
    res = await renderURL(arg1, opts);
  } else {
    if (!arg1) { console.error('Missing <FILE>'); process.exit(2); }
    const html = await fs.readFile(path.resolve(process.cwd(), arg1), 'utf8');
    res = await renderHTML(html, opts);
  }
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => { console.error(err?.stack || String(err)); process.exit(1); });

