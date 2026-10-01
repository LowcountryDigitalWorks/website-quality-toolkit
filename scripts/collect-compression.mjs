import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

export const COMPRESSION_PROBE_SCHEMA = 'ldw.wqt-compression-probe.v1';
export const ACCEPT_ENCODING = 'zstd, br, gzip';
export const PROBE_USER_AGENT = 'LDW-Website-Quality-Compression-Probe/1.0';
export const MAX_PROBE_URLS = 64;
export const REQUEST_TIMEOUT_MS = 10_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function asciiCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function canonicalTarget(value) {
  if (typeof value !== 'string') throw new Error('target must be a canonical HTTPS origin');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('target must be a canonical HTTPS origin');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
    || parsed.search || parsed.hash || parsed.origin !== value) {
    throw new Error('target must be a canonical HTTPS origin');
  }
  return parsed;
}

export function classifyContentEncoding(value) {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value !== 'string') return 'unknown';
  const tokens = value.toLowerCase().split(',').map((token) => token.trim()).filter(Boolean);
  if (tokens.length !== 1) return 'unknown';
  if (tokens[0] === 'identity') return 'none';
  if (tokens[0] === 'zstd' || tokens[0] === 'br' || tokens[0] === 'gzip') return tokens[0];
  return 'unknown';
}

export function classifyResourceClass(contentType) {
  if (contentType === null || contentType === undefined || contentType === '') return 'unknown';
  if (typeof contentType !== 'string') return 'unknown';
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!mediaType) return 'unknown';

  if (mediaType.startsWith('text/')
    || mediaType === 'image/svg+xml'
    || mediaType === 'application/javascript'
    || mediaType === 'application/x-javascript'
    || mediaType === 'application/json'
    || mediaType.endsWith('+json')
    || mediaType === 'application/xml'
    || mediaType.endsWith('+xml')
    || mediaType === 'application/xhtml+xml'
    || mediaType === 'application/manifest+json'
    || mediaType === 'application/wasm') {
    return 'compressible';
  }

  if (mediaType.startsWith('image/')
    || mediaType.startsWith('audio/')
    || mediaType.startsWith('video/')
    || mediaType.startsWith('font/')
    || mediaType === 'application/pdf'
    || mediaType === 'application/zip'
    || mediaType === 'application/octet-stream'
    || mediaType === 'application/font-woff'
    || mediaType === 'application/vnd.ms-fontobject') {
    return 'non-compressible';
  }

  return 'unknown';
}

export function selectProbeUrls(siteone, target) {
  if (!isPlainObject(siteone) || !Array.isArray(siteone.results)) {
    throw new Error('SiteOne evidence must contain results[]');
  }
  const targetUrl = canonicalTarget(target);
  const urls = new Set();

  for (const [index, result] of siteone.results.entries()) {
    if (!isPlainObject(result)) throw new Error(`SiteOne result[${index}] must be a JSON object`);
    if (typeof result.status !== 'string') throw new Error(`SiteOne result[${index}].status must be a string`);
    if (typeof result.url !== 'string') throw new Error(`SiteOne result[${index}].url must be a string`);
    if (result.status !== '200') continue;

    let parsed;
    try {
      parsed = new URL(result.url);
    } catch {
      throw new Error(`SiteOne result[${index}].url must be an absolute URL`);
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) continue;
    if (parsed.origin !== targetUrl.origin) continue;
    urls.add(parsed.href);
  }

  if (urls.size === 0) throw new Error('No same-origin SiteOne 200 URLs are available for compression probing');
  if (urls.size > MAX_PROBE_URLS) {
    throw new Error(`Compression probe URL count exceeds bounded maximum of ${MAX_PROBE_URLS}`);
  }
  return [...urls].sort(asciiCompare);
}

function headerValue(headers, name) {
  const value = headers[name];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : null;
}

function parseContentLength(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function requestOptions() {
  return {
    method: 'GET',
    headers: {
      'Accept': '*/*',
      'Accept-Encoding': ACCEPT_ENCODING,
      'User-Agent': PROBE_USER_AGENT,
      'Connection': 'close',
    },
  };
}

export function probeUrl(url, { requestImpl = https.request } = {}) {
  return new Promise((resolve, reject) => {
    const req = requestImpl(url, requestOptions(), (res) => {
      const contentEncoding = headerValue(res.headers, 'content-encoding');
      const contentType = headerValue(res.headers, 'content-type');
      const sample = {
        url,
        statusCode: Number.isInteger(res.statusCode) ? res.statusCode : null,
        contentEncoding,
        encodingClass: classifyContentEncoding(contentEncoding),
        contentType,
        resourceClass: classifyResourceClass(contentType),
        contentLength: parseContentLength(headerValue(res.headers, 'content-length')),
      };

      res.on('error', reject);
      res.on('end', () => resolve(sample));
      res.resume();
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`compression probe timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function collectCompressionEvidence({ target, siteone, probe = probeUrl }) {
  const targetUrl = canonicalTarget(target);
  const urls = selectProbeUrls(siteone, target);
  const samples = [];
  for (const url of urls) {
    samples.push(await probe(url));
  }

  return {
    schemaVersion: COMPRESSION_PROBE_SCHEMA,
    executedAt: new Date().toISOString(),
    target: targetUrl.origin,
    request: {
      acceptEncoding: ACCEPT_ENCODING,
      userAgent: PROBE_USER_AGENT,
      redirectPolicy: 'manual',
    },
    samples,
  };
}

function usage() {
  return 'Usage: node scripts/collect-compression.mjs --target <origin> --siteone <file> --output <file>';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(usage());
    args[key.slice(2)] = value;
  }
  for (const required of ['target', 'siteone', 'output']) {
    if (!args[required]) throw new Error(`Missing --${required}. ${usage()}`);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const siteone = JSON.parse(fs.readFileSync(args.siteone, 'utf8'));
    const evidence = await collectCompressionEvidence({
      target: args.target,
      siteone,
    });
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
