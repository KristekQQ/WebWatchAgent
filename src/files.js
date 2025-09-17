// @ts-check
/**
 * File utilities used by the Web Watcher.
 *
 * This module provides small, battle-tested helpers for:
 * - Creating directories recursively (mkdir -p behavior)
 * - Atomic file writes (write temp then rename) to avoid partial reads
 * - Reading/writing JSON with proper UTF-8 encoding
 * - Guarded path joining to keep outputs inside a base directory
 * - A minimal sleep utility for timing control
 */

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Ensure that a directory exists.
 * Creates parent directories as needed (recursive: true).
 * @param {string} dir Absolute or relative directory path.
 */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Atomically write a file by writing to a temp file then renaming.
 * This prevents consumers from ever observing a partially-written file.
 * @param {string} filePath Destination path of the final file.
 * @param {Uint8Array|string} data File contents.
 */
export async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.tmp-${randomUUID()}`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

/**
 * Write a JSON-serializable object atomically.
 * @template T
 * @param {string} filePath Destination JSON file path.
 * @param {T} obj JSON-serializable data.
 */
export async function writeJSONAtomic(filePath, obj) {
  const data = JSON.stringify(obj, null, 2);
  await writeFileAtomic(filePath, data);
}

/**
 * Read a JSON file as UTF-8 and parse it.
 * @param {string} filePath JSON file path.
 * @returns {Promise<any>} Parsed JSON object.
 */
export async function readJSON(filePath) {
  const buf = await fs.readFile(filePath, 'utf8');
  return JSON.parse(buf);
}

/**
 * Safely join a path to a base directory and ensure the
 * resolved path remains within the base. Helps defend against
 * path traversal when using untrusted names.
 * @param {string} baseDir Base directory.
 * @param {string} target Additional path segment(s).
 */
export function safeJoin(baseDir, target) {
  const resolved = path.resolve(baseDir, target);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Unsafe path resolution: ${resolved}`);
  }
  return resolved;
}

/**
 * Simple sleep helper using native promises.
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>} Promise resolving after the delay.
 */
export function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}
