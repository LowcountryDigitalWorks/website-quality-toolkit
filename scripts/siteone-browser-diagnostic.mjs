import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_URL = 'https://lowcountrydigitalworks.com/';
export const INPUT_LIMIT = 2 * 1024 * 1024;
const SCHEMA = 'ldw.wqt-siteone-browser-diagnostic.v1';
const VERSION = /^2\.5\.1(?:\.|$)/;
const CHALLENGE_PREFIX = 'https://lowcountrydigitalworks.com/cdn-cgi/challenge-platform/';

function fail() { throw new Error('Invalid or untrusted SiteOne diagnostic input'); }

export function parseScanExitCode(value) {
  if (!/^(?:0|[1-9][0-9]{0,2})$/.test(String(value))) fail();
  const code = Number(value);
  if (!Number.isSafeInteger(code) || code > 255) fail();
  return code;
}

export function parseSiteoneRaw(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail();
  if (typeof raw.crawler?.version !== 'string' || !VERSION.test(raw.crawler.version)) fail();
  if (!Array.isArray(raw.results) || raw.results.length > 1024) fail();
  const roots = raw.results.filter((item) => item && typeof item === 'object' && item.url === ROOT_URL);
  if (roots.length > 1) fail();
  let rootHttpStatus = null;
  if (roots.length === 1) {
    const rawStatus = roots[0].status;
    if ((typeof rawStatus === 'string' || typeof rawStatus === 'number')
      && /^[1-5][0-9]{2}$/.test(String(rawStatus))) {
      rootHttpStatus = Number(rawStatus);
    }
  }
  const challengeResourceObserved = raw.results.some((item) =>
    item && typeof item.url === 'string' && item.url.startsWith(CHALLENGE_PREFIX));
  let coverage = 'unknown';
  if (rootHttpStatus !== null && rootHttpStatus >= 400) coverage = 'blocked_or_http_error';
  else if (rootHttpStatus === 200 && challengeResourceObserved) coverage = 'http_200_challenge_resource_seen';
  else if (rootHttpStatus === 200) coverage = 'http_200_content_unverified';
  else if (rootHttpStatus !== null) coverage = 'non_200_content_unverified';
  return { rootHttpStatus, challengeResourceObserved, coverage };
}

export function summarizeDiagnostic(raw, exitCode, collectedAt) {
  const code = parseScanExitCode(exitCode);
  if (typeof collectedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(collectedAt)
    || !Number.isFinite(Date.parse(collectedAt)) || new Date(collectedAt).toISOString() !== collectedAt) fail();
  const derived = raw === null
    ? { rootHttpStatus: null, challengeResourceObserved: false, coverage: 'unknown' }
    : parseSiteoneRaw(raw);
  return {
    schemaVersion: SCHEMA,
    siteId: 'lowcountrydigitalworks',
    targetRootUrl: ROOT_URL,
    scanner: 'siteone-crawler',
    pinnedVersion: '2.5.1',
    collectionMethod: 'single_page_chromium_default_sandbox',
    diagnosticGeneratedAt: collectedAt,
    scannerExitCode: code,
    rootHttpStatus: derived.rootHttpStatus,
    challengeResourceObserved: derived.challengeResourceObserved,
    coverage: derived.coverage,
    pageContentVerified: false,
    evidenceOnly: true,
    note: 'HTTP status and resource markers do not establish authentic homepage HTML or challenge clearance.',
  };
}

export function readBoundedJson(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const chunks = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(65536, INPUT_LIMIT - total + 1));
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > INPUT_LIMIT) fail();
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { fail(); }
    try { return JSON.parse(text); }
    catch { fail(); }
  } finally { fs.closeSync(fd); }
}

function main(argv) {
  if (argv.length !== 3) fail();
  const [inputPath, outputPath, exitCode] = argv;
  const raw = fs.existsSync(inputPath) ? readBoundedJson(inputPath) : null;
  const summary = summarizeDiagnostic(raw, exitCode, new Date().toISOString());
  // Only fixed allowlisted summary values are written; raw SiteOne data stays ephemeral.
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
const mainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (mainModule) {
  try { main(process.argv.slice(2)); }
  catch { process.stderr.write('SiteOne diagnostic refused malformed or unavailable source evidence.\n'); process.exitCode = 1; }
}
