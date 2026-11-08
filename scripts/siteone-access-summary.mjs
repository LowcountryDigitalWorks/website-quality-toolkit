// Operator-only, synthetic-safe SiteOne root-access context; NOT normalized WQT evidence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from './resolve-target.mjs';

export const MAX_RAW_BYTES = 32 * 1024 * 1024;
const VERSION = /^2\.5\.1(?:\.|$)/;
const VALID_STATUS = /^[1-5][0-9]{2}$/;

function fail() { throw new Error('SiteOne access diagnostic refused untrusted source'); }

export function classifySiteOneAccess(raw, origin) {
  if (typeof origin !== 'string' || new URL(origin).origin !== origin) fail();
  const unknown = { coverage: 'unknown', rootHttpStatus: null, challengeResourceObserved: false };
  if (raw === null) return { ...unknown, coverage: 'raw_unavailable' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || typeof raw.crawler?.version !== 'string' || !VERSION.test(raw.crawler.version)) fail();
  if (!Array.isArray(raw.results)) return unknown;
  if (raw.results.length > 50000) fail();

  const root = origin + '/';
  const challengePrefix = root + 'cdn-cgi/challenge-platform/';
  const roots = [];
  let challengeResourceObserved = false;
  for (const item of raw.results) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.url === origin || item.url === root) roots.push(item);
    if (typeof item.url === 'string' && item.url.startsWith(challengePrefix)) {
      challengeResourceObserved = true;
    }
  }
  if (roots.length !== 1) return { ...unknown, challengeResourceObserved };
  const value = roots[0].status;
  if ((typeof value !== 'string' && typeof value !== 'number') || !VALID_STATUS.test(String(value))) {
    return { ...unknown, challengeResourceObserved };
  }
  const rootHttpStatus = Number(value);
  let coverage = 'unknown';
  if (rootHttpStatus >= 400) coverage = 'blocked_root_http_error';
  else if (rootHttpStatus === 200 && challengeResourceObserved) coverage = 'http_200_challenge_resource_seen_content_unverified';
  else if (rootHttpStatus === 200) coverage = 'http_200_content_unverified';
  else if (rootHttpStatus >= 300 && rootHttpStatus < 400) coverage = 'redirect_unverified';
  else if (rootHttpStatus >= 201 && rootHttpStatus < 300) coverage = 'other_success_content_unverified';
  return { coverage, rootHttpStatus, challengeResourceObserved };
}

export function renderAccessNotice(siteId, result) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(siteId)) fail();
  const allowed = new Set([
    'unknown', 'raw_unavailable', 'blocked_root_http_error',
    'http_200_challenge_resource_seen_content_unverified', 'http_200_content_unverified',
    'redirect_unverified', 'other_success_content_unverified',
  ]);
  if (!result || !allowed.has(result.coverage)
      || (result.rootHttpStatus !== null
        && (!Number.isInteger(result.rootHttpStatus) || result.rootHttpStatus < 100 || result.rootHttpStatus > 599))
      || typeof result.challengeResourceObserved !== 'boolean') fail();
  return [
    '### SiteOne homepage access — diagnostic only',
    '',
    '- Authorized site ID: ' + siteId,
    '- Source: pinned SiteOne 2.5.1 raw results, same attempted scan; no new request.',
    '- Coverage: ' + result.coverage + '.',
    '- Exact target-root HTTP status: ' + (result.rootHttpStatus ?? 'not observed') + '.',
    '- Challenge-platform resource: ' + (result.challengeResourceObserved ? 'observed' : 'not observed; absence is not proved') + '.',
    '- **No actual homepage content verification or site-health verdict.** A 200 alone is not an authentic-content proof. A 4xx/5xx root blocks reliable SiteOne quality normalization.',
    '- Existing scanner/normalizer job result and raw artifacts remain authoritative; this note never converts a failed scan to PASS.',
    '',
  ].join('\n');
}

export function readRawIfPresent(file) {
  // Open exactly once with no symlink traversal. Checking a path with lstat()
  // and subsequently opening by path would introduce a time-of-check/use race.
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_NONBLOCK)) fail();
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail();
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_RAW_BYTES) fail();

    // Even if a regular file grows after fstat(), read at most MAX_RAW_BYTES+1
    // using only the already-validated descriptor, never a second path lookup.
    const chunks = [];
    let size = 0;
    while (true) {
      const remaining = MAX_RAW_BYTES + 1 - size;
      const next = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const count = fs.readSync(descriptor, next, 0, next.length, null);
      if (count === 0) break;
      size += count;
      if (size > MAX_RAW_BYTES) fail();
      chunks.push(next.subarray(0, count));
    }
    const bytes = Buffer.concat(chunks, size);
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail(); }
  } finally {
    fs.closeSync(descriptor);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    if (process.argv.length !== 4) fail();
    const origin = resolveTarget(process.argv[2]); // Fixed repository registry; no free-form URL.
    const raw = readRawIfPresent(process.argv[3]);
    process.stdout.write(renderAccessNotice(process.argv[2], classifySiteOneAccess(raw, origin)));
  } catch {
    // Best-effort presentation must not change the existing scanner/normalizer
    // job verdict. Unsafe or unsupported diagnostics become UNKNOWN, never PASS.
    process.stdout.write(
      '### SiteOne homepage access — diagnostic unavailable\n\n'
      + '- Coverage: unknown. No scanner quality or homepage content verdict.\n'
      + '- Existing scanner/normalizer result and raw artifacts remain authoritative.\n',
    );
  }
}
