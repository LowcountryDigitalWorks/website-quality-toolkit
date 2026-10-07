import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import dnsPromises from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveTarget } from './resolve-target.mjs';

const execFileAsync = promisify(execFile);

export const SIDECAR_SCHEMA_VERSION = 'ldw.wqt-external-links.v1';
export const SIDECAR_SCHEMA_MINOR = 1;
export const DEFAULT_USER_AGENT = 'LDW-WebsiteQualityToolkit-LinkCheck/1.0 (+https://github.com/LowcountryDigitalWorks/website-quality-toolkit)';

export const HARD_BOUNDS = Object.freeze({
  maxUrls: 100,
  maxHosts: 25,
  maxConcurrency: 4,
  minHostIntervalMs: 1000,
  requestTimeoutMs: 10000,
});

function parseIPv4(ip) {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split('.');
  let num = 0n;
  for (const p of parts) {
    num = (num << 8n) | BigInt(p);
  }
  return num;
}

const ipv4DisallowedCidrs = [
  { cidr: '0.0.0.0/8', base: parseIPv4('0.0.0.0'), mask: 0xff000000n },
  { cidr: '10.0.0.0/8', base: parseIPv4('10.0.0.0'), mask: 0xff000000n },
  { cidr: '100.64.0.0/10', base: parseIPv4('100.64.0.0'), mask: 0xffc00000n },
  { cidr: '127.0.0.0/8', base: parseIPv4('127.0.0.0'), mask: 0xff000000n },
  { cidr: '169.254.0.0/16', base: parseIPv4('169.254.0.0'), mask: 0xffff0000n },
  { cidr: '172.16.0.0/12', base: parseIPv4('172.16.0.0'), mask: 0xfff00000n },
  { cidr: '192.0.0.0/24', base: parseIPv4('192.0.0.0'), mask: 0xffffff00n },
  { cidr: '192.0.2.0/24', base: parseIPv4('192.0.2.0'), mask: 0xffffff00n },
  { cidr: '192.88.99.0/24', base: parseIPv4('192.88.99.0'), mask: 0xffffff00n },
  { cidr: '192.168.0.0/16', base: parseIPv4('192.168.0.0'), mask: 0xffff0000n },
  { cidr: '198.18.0.0/15', base: parseIPv4('198.18.0.0'), mask: 0xfffe0000n },
  { cidr: '198.51.100.0/24', base: parseIPv4('198.51.100.0'), mask: 0xffffff00n },
  { cidr: '203.0.113.0/24', base: parseIPv4('203.0.113.0'), mask: 0xffffff00n },
  { cidr: '224.0.0.0/4', base: parseIPv4('224.0.0.0'), mask: 0xf0000000n },
  { cidr: '240.0.0.0/4', base: parseIPv4('240.0.0.0'), mask: 0xf0000000n },
  { cidr: '255.255.255.255/32', base: parseIPv4('255.255.255.255'), mask: 0xffffffffn },
];

function isGloballyRoutableIPv4(ip) {
  const num = parseIPv4(ip);
  if (num === null) return false;
  for (const range of ipv4DisallowedCidrs) {
    if ((num & range.mask) === range.base) {
      return false;
    }
  }
  return true;
}

function parseIPv6(ip) {
  if (!net.isIPv6(ip)) return null;
  let cleanIp = ip.toLowerCase();
  const ipv4MappedMatch = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4MappedMatch) {
    return { isMapped: true, v4: ipv4MappedMatch[1] };
  }
  const parts = cleanIp.split('::');
  if (parts.length > 2) return null;
  let left = parts[0] ? parts[0].split(':') : [];
  let right = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  const hexParts = [...left, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...right];
  if (hexParts.length !== 8) return null;
  let num = 0n;
  for (const h of hexParts) {
    num = (num << 16n) | BigInt(parseInt(h, 16));
  }
  return { isMapped: false, num };
}

function makeIPv6Mask(bits) {
  return ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
}

const ipv6DisallowedCidrs = [
  { cidr: '::/128', num: 0n, mask: makeIPv6Mask(128) },
  { cidr: '::1/128', num: 1n, mask: makeIPv6Mask(128) },
  { cidr: '64:ff9b::/96', num: parseIPv6('64:ff9b::').num, mask: makeIPv6Mask(96) },
  { cidr: '100::/64', num: parseIPv6('100::').num, mask: makeIPv6Mask(64) },
  { cidr: '2001::/23', num: parseIPv6('2001::').num, mask: makeIPv6Mask(23) },
  { cidr: '2001:20::/28', num: parseIPv6('2001:20::').num, mask: makeIPv6Mask(28) },
  { cidr: '2001:db8::/32', num: parseIPv6('2001:db8::').num, mask: makeIPv6Mask(32) },
  { cidr: '2002::/16', num: parseIPv6('2002::').num, mask: makeIPv6Mask(16) },
  { cidr: 'fc00::/7', num: parseIPv6('fc00::').num, mask: makeIPv6Mask(7) },
  { cidr: 'fe80::/10', num: parseIPv6('fe80::').num, mask: makeIPv6Mask(10) },
  { cidr: 'ff00::/8', num: parseIPv6('ff00::').num, mask: makeIPv6Mask(8) },
];

function isGloballyRoutableIPv6(ip) {
  const parsed = parseIPv6(ip);
  if (!parsed) return false;
  if (parsed.isMapped) {
    return isGloballyRoutableIPv4(parsed.v4);
  }
  for (const range of ipv6DisallowedCidrs) {
    if ((parsed.num & range.mask) === range.num) {
      return false;
    }
  }
  return true;
}

export function isGloballyRoutableIp(ip) {
  if (net.isIPv4(ip)) return isGloballyRoutableIPv4(ip);
  if (net.isIPv6(ip)) return isGloballyRoutableIPv6(ip);
  return false;
}

export function extractExternalUrlsFromSiteOne(siteoneData) {
  if (!siteoneData || typeof siteoneData !== 'object') {
    throw new Error('malformed or missing SiteOne raw evidence');
  }
  const skippedRows = siteoneData.tables?.skipped?.rows;
  if (!Array.isArray(skippedRows)) {
    throw new Error('malformed or missing SiteOne tables.skipped.rows evidence');
  }

  const urlMap = new Map();
  for (let i = 0; i < skippedRows.length; i++) {
    const row = skippedRows[i];
    if (!row || typeof row !== 'object') {
      throw new Error(`skipped row[${i}] must be an object`);
    }
    if (typeof row.reason !== 'string') {
      throw new Error(`skipped row[${i}].reason must be a string`);
    }
    if (row.reason !== 'Not allowed host') {
      continue;
    }
    if (typeof row.url !== 'string') {
      throw new Error(`skipped row[${i}].url must be a string`);
    }

    let parsed;
    try {
      parsed = new URL(row.url);
    } catch {
      throw new Error(`skipped row[${i}].url must be a parseable URL`);
    }

    const href = parsed.href;
    const sourceUqId = typeof row.sourceUqId === 'string' ? row.sourceUqId : null;
    const sourceAttr = typeof row.sourceAttr === 'string' ? row.sourceAttr : null;

    if (!urlMap.has(href)) {
      urlMap.set(href, {
        url: href,
        host: parsed.hostname,
        sourceContext: { sourceUqId, sourceAttr },
      });
    }
  }

  const sortedUrls = Array.from(urlMap.values()).sort((a, b) => a.url.localeCompare(b.url));
  return sortedUrls;
}

const LOCALHOST_ALIASES = new Set([
  'localhost',
  'localhost.localdomain',
  'loopback',
  '0.0.0.0',
]);

function isLocalhostOrInternalAlias(hostname) {
  const lower = hostname.toLowerCase();
  if (LOCALHOST_ALIASES.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  return false;
}

export async function validateAndResolveDestination(urlStr, { dnsResolver = null } = {}) {
  let urlObj;
  try {
    urlObj = new URL(urlStr);
  } catch {
    return { safe: false, reason: 'unparseable URL syntax' };
  }

  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return { safe: false, reason: `unsupported scheme "${urlObj.protocol}"` };
  }

  const effectivePort = urlObj.port
    ? parseInt(urlObj.port, 10)
    : (urlObj.protocol === 'https:' ? 443 : 80);

  if (effectivePort !== 80 && effectivePort !== 443) {
    return { safe: false, reason: `unsupported port ${effectivePort}` };
  }

  if (urlObj.username || urlObj.password) {
    return { safe: false, reason: 'URL userinfo disallowed' };
  }

  const rawHostname = urlObj.hostname;
  if (!rawHostname) {
    return { safe: false, reason: 'missing hostname' };
  }

  let cleanHostname = rawHostname;
  if (cleanHostname.startsWith('[') && cleanHostname.endsWith(']')) {
    cleanHostname = cleanHostname.slice(1, -1);
  }

  if (isLocalhostOrInternalAlias(cleanHostname)) {
    return { safe: false, reason: 'localhost or internal alias disallowed' };
  }

  if (net.isIP(cleanHostname)) {
    if (!isGloballyRoutableIp(cleanHostname)) {
      return { safe: false, reason: `destination IP ${cleanHostname} is non-global or private` };
    }
    return {
      safe: true,
      hostname: rawHostname,
      port: effectivePort,
      pinnedIp: cleanHostname,
      resolvedIps: [cleanHostname],
    };
  }

  const resolver4 = dnsResolver?.resolve4 ?? dnsPromises.resolve4;
  const resolver6 = dnsResolver?.resolve6 ?? dnsPromises.resolve6;

  let ipv4s = [];
  let ipv6s = [];
  let dnsError = null;

  try {
    ipv4s = await resolver4(cleanHostname);
  } catch (err) {
    if (err.code !== 'ENOTFOUND' && err.code !== 'NODATA') {
      dnsError = err;
    }
  }

  try {
    ipv6s = await resolver6(cleanHostname);
  } catch (err) {
    if (err.code !== 'ENOTFOUND' && err.code !== 'NODATA') {
      if (!dnsError) dnsError = err;
    }
  }

  const allIps = Array.from(new Set([...(ipv4s || []), ...(ipv6s || [])]));

  if (allIps.length === 0) {
    if (dnsError) {
      return { safe: false, dnsFailure: true, reason: `DNS resolution failed: ${dnsError.code || dnsError.message}` };
    }
    return { safe: false, dnsFailure: true, reason: 'DNS resolution failed: ENOTFOUND' };
  }

  for (const ip of allIps) {
    if (!isGloballyRoutableIp(ip)) {
      return {
        safe: false,
        reason: `resolved address ${ip} is non-global or private (mixed public/private DNS answers rejected)`,
      };
    }
  }

  const sortedIps = [...allIps].sort();
  const pinnedIp = sortedIps[0];

  return {
    safe: true,
    hostname: rawHostname,
    port: effectivePort,
    pinnedIp,
    resolvedIps: sortedIps,
  };
}

export function sanitizeLocationHeader(locationRaw, baseUrl) {
  if (!locationRaw || typeof locationRaw !== 'string') return null;
  const trimmed = locationRaw.trim();
  if (!trimmed) return null;

  let targetUrl;
  try {
    targetUrl = new URL(trimmed, baseUrl);
  } catch {
    return trimmed.slice(0, 256);
  }

  targetUrl.username = '';
  targetUrl.password = '';
  return targetUrl.href.slice(0, 512);
}

export async function executeCurlTransport(urlStr, destination, method = 'HEAD', {
  execFileFn = execFileAsync,
  timeoutMs = HARD_BOUNDS.requestTimeoutMs,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const { hostname, port, pinnedIp } = destination;
  const resolveSpec = `${hostname}:${port}:${pinnedIp}`;

  const args = [
    '--silent',
    '--show-error',
    '--no-buffer',
    '--dump-header', '-',
    '--output', '/dev/null',
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '--user-agent', userAgent,
    '--resolve', resolveSpec,
  ];

  if (method === 'HEAD') {
    args.push('--head');
  } else if (method === 'GET') {
    args.push('-r', '0-1023');
  }

  args.push(urlStr);

  try {
    const { stdout, stderr } = await execFileFn('curl', args, {
      timeout: timeoutMs + 1000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const headerText = stdout.toString('utf8');
    const headerLines = headerText.split(/\r?\n/);
    let statusCode = null;
    let locationHeader = null;

    for (const line of headerLines) {
      const statusMatch = line.match(/^HTTP\/[12](\.[019])?\s+(\d{3})/i);
      if (statusMatch) {
        statusCode = parseInt(statusMatch[2], 10);
      }
      const locMatch = line.match(/^Location:\s*(.+)$/i);
      if (locMatch) {
        locationHeader = locMatch[1].trim();
      }
    }

    return {
      success: true,
      statusCode,
      locationHeader: sanitizeLocationHeader(locationHeader, urlStr),
      rawHeaders: headerText,
      stderr: stderr?.toString('utf8') || '',
    };
  } catch (err) {
    const stderrMsg = err.stderr ? err.stderr.toString('utf8').trim() : '';
    const errorMsg = err.message || 'curl execution failed';
    return {
      success: false,
      statusCode: null,
      error: stderrMsg || errorMsg,
    };
  }
}

export function classifyHttpResponse(statusCode, locationHeader) {
  if (statusCode === null || statusCode === undefined) {
    return { state: 'unavailable_unknown', detail: 'no response status received' };
  }
  if (statusCode >= 200 && statusCode <= 299) {
    return { state: 'reachable', detail: null };
  }
  if (statusCode >= 300 && statusCode <= 399) {
    return {
      state: 'redirect_observed',
      location: locationHeader,
      detail: `redirect observed (${statusCode})`,
    };
  }
  if (statusCode === 403 || statusCode === 429) {
    return {
      state: 'blocked_or_rate_limited',
      detail: `destination returned ${statusCode}`,
    };
  }
  if (statusCode >= 400 && statusCode <= 599) {
    return {
      state: 'http_error',
      detail: `HTTP error status ${statusCode}`,
    };
  }
  return {
    state: 'unavailable_unknown',
    detail: `unexpected HTTP status ${statusCode}`,
  };
}

export async function probeSingleUrl(item, {
  dnsResolver = null,
  transportFn = null,
  timeoutMs = HARD_BOUNDS.requestTimeoutMs,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  const urlStr = item.url;
  const host = item.host || new URL(urlStr).hostname;

  const resolved = await validateAndResolveDestination(urlStr, { dnsResolver });

  if (!resolved.safe) {
    if (resolved.dnsFailure) {
      return {
        url: urlStr,
        host,
        state: 'unavailable_unknown',
        sourceContext: item.sourceContext,
        statusCode: null,
        pinnedIp: null,
        location: null,
        detail: resolved.reason,
      };
    }
    return {
      url: urlStr,
      host,
      state: 'unsafe_destination_rejected',
      sourceContext: item.sourceContext,
      statusCode: null,
      pinnedIp: null,
      location: null,
      detail: resolved.reason,
    };
  }

  const transport = transportFn || executeCurlTransport;

  let headResult = await transport(urlStr, resolved, 'HEAD', { timeoutMs, userAgent });

  if (headResult.success && (headResult.statusCode === 405 || headResult.statusCode === 501)) {
    const getResult = await transport(urlStr, resolved, 'GET', { timeoutMs, userAgent });
    if (getResult.success) {
      const classification = classifyHttpResponse(getResult.statusCode, getResult.locationHeader);
      return {
        url: urlStr,
        host,
        state: classification.state,
        sourceContext: item.sourceContext,
        statusCode: getResult.statusCode,
        pinnedIp: resolved.pinnedIp,
        location: classification.location || null,
        detail: classification.detail || 'HEAD unsupported (405/501); fallback to GET succeeded',
      };
    } else {
      return {
        url: urlStr,
        host,
        state: 'unavailable_unknown',
        sourceContext: item.sourceContext,
        statusCode: null,
        pinnedIp: resolved.pinnedIp,
        location: null,
        detail: `HEAD returned ${headResult.statusCode}; GET fallback transport failed: ${getResult.error}`,
      };
    }
  }

  if (!headResult.success) {
    return {
      url: urlStr,
      host,
      state: 'unavailable_unknown',
      sourceContext: item.sourceContext,
      statusCode: null,
      pinnedIp: resolved.pinnedIp,
      location: null,
      detail: headResult.error,
    };
  }

  const classification = classifyHttpResponse(headResult.statusCode, headResult.locationHeader);
  return {
    url: urlStr,
    host,
    state: classification.state,
    sourceContext: item.sourceContext,
    statusCode: headResult.statusCode,
    pinnedIp: resolved.pinnedIp,
    location: classification.location || null,
    detail: classification.detail,
  };
}

export async function processAllProbesWithBounds(items, {
  dnsResolver = null,
  transportFn = null,
  timeoutMs = HARD_BOUNDS.requestTimeoutMs,
  userAgent = DEFAULT_USER_AGENT,
  maxUrls = HARD_BOUNDS.maxUrls,
  maxHosts = HARD_BOUNDS.maxHosts,
  maxConcurrency = HARD_BOUNDS.maxConcurrency,
  minHostIntervalMs = HARD_BOUNDS.minHostIntervalMs,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const hostToItemsMap = new Map();
  const hostOrder = [];

  for (const item of items) {
    const host = item.host || new URL(item.url).hostname;
    if (!hostToItemsMap.has(host)) {
      hostToItemsMap.set(host, []);
      hostOrder.push(host);
    }
    hostToItemsMap.get(host).push(item);
  }

  let allowedHosts = hostOrder;
  let coverageExceeded = false;

  if (items.length > maxUrls || hostOrder.length > maxHosts) {
    coverageExceeded = true;
  }

  if (allowedHosts.length > maxHosts) {
    allowedHosts = allowedHosts.slice(0, maxHosts);
  }

  const attemptedItems = [];
  const unattemptedItems = [];

  for (const host of hostOrder) {
    const hostItems = hostToItemsMap.get(host);
    if (!allowedHosts.includes(host)) {
      unattemptedItems.push(...hostItems);
      continue;
    }
    for (const item of hostItems) {
      if (attemptedItems.length < maxUrls) {
        attemptedItems.push(item);
      } else {
        unattemptedItems.push(item);
      }
    }
  }

  const resultsMap = new Map();
  const hostLastRequestTime = new Map();

  for (const item of unattemptedItems) {
    const host = item.host || new URL(item.url).hostname;
    resultsMap.set(item.url, {
      url: item.url,
      host,
      state: 'unattempted_due_to_limits',
      sourceContext: item.sourceContext,
      statusCode: null,
      pinnedIp: null,
      location: null,
      detail: 'coverage limit exceeded (URL or host bound reached)',
    });
  }

  let activeGlobalCount = 0;
  const activeHosts = new Set();
  const queue = [...attemptedItems];

  await new Promise((resolve) => {
    function tryProcessQueue() {
      if (queue.length === 0 && activeGlobalCount === 0) {
        resolve();
        return;
      }

      while (queue.length > 0 && activeGlobalCount < maxConcurrency) {
        let candidateIdx = -1;
        const now = Date.now();

        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          const host = item.host || new URL(item.url).hostname;
          if (activeHosts.has(host)) continue;
          const lastTime = hostLastRequestTime.get(host) || 0;
          if (now - lastTime >= minHostIntervalMs) {
            candidateIdx = i;
            break;
          }
        }

        if (candidateIdx === -1) {
          const readyHostTime = Math.min(
            ...queue.map((item) => {
              const host = item.host || new URL(item.url).hostname;
              if (activeHosts.has(host)) return Infinity;
              const lastTime = hostLastRequestTime.get(host) || 0;
              return Math.max(0, minHostIntervalMs - (now - lastTime));
            }),
          );

          if (readyHostTime > 0 && Number.isFinite(readyHostTime)) {
            sleepFn(readyHostTime).then(tryProcessQueue);
          }
          break;
        }

        const [item] = queue.splice(candidateIdx, 1);
        const host = item.host || new URL(item.url).hostname;

        activeGlobalCount++;
        activeHosts.add(host);
        hostLastRequestTime.set(host, Date.now());

        probeSingleUrl(item, { dnsResolver, transportFn, timeoutMs, userAgent })
          .then((res) => {
            resultsMap.set(item.url, res);
          })
          .finally(() => {
            activeGlobalCount--;
            activeHosts.delete(host);
            tryProcessQueue();
          });
      }
    }

    tryProcessQueue();
  });

  const finalResults = items.map((item) => resultsMap.get(item.url));
  return {
    coverageCompleteness: coverageExceeded ? 'coverage_limit_exceeded' : 'complete',
    results: finalResults,
  };
}

export function renderExternalLinksSummary(sidecarData) {
  const {
    siteId,
    target,
    siteoneVersion,
    executedAt,
    counts,
    coverageCompleteness,
    results,
  } = sidecarData;

  const stateCounts = {
    reachable: 0,
    redirect_observed: 0,
    blocked_or_rate_limited: 0,
    http_error: 0,
    unavailable_unknown: 0,
    unsafe_destination_rejected: 0,
    unattempted_due_to_limits: 0,
  };

  for (const r of results || []) {
    if (stateCounts[r.state] !== undefined) {
      stateCounts[r.state]++;
    }
  }

  const nonReachable = (results || []).filter((r) => r.state !== 'reachable');
  const attentionList = nonReachable.slice(0, 10);

  let md = `## External-Link Reachability Sidecar\n\n`;
  md += `- **Site Identifier:** \`${siteId}\`\n`;
  md += `- **Authorized Target:** \`${target}\`\n`;
  md += `- **Source Crawler:** SiteOne \`${siteoneVersion}\`\n`;
  md += `- **Execution Time:** \`${executedAt}\`\n`;
  md += `- **Coverage State:** \`${coverageCompleteness}\`\n\n`;

  md += `### Summary Counts\n\n`;
  md += `| Category | Count |\n`;
  md += `| --- | --- |\n`;
  md += `| Total Discovered External URLs | ${counts.totalDiscovered} |\n`;
  md += `| Attempted Probes | ${counts.totalAttempted} |\n`;
  md += `| Unsafe / Rejected Destinations | ${counts.totalRejected} |\n`;
  md += `| Unattempted (Limits Exceeded) | ${counts.totalUnattempted} |\n\n`;

  md += `### Factual Status Breakdown\n\n`;
  md += `| Status State | Count |\n`;
  md += `| --- | --- |\n`;
  md += `| \`reachable\` (2xx) | ${stateCounts.reachable} |\n`;
  md += `| \`redirect_observed\` (3xx) | ${stateCounts.redirect_observed} |\n`;
  md += `| \`blocked_or_rate_limited\` (403/429) | ${stateCounts.blocked_or_rate_limited} |\n`;
  md += `| \`http_error\` (4xx/5xx) | ${stateCounts.http_error} |\n`;
  md += `| \`unavailable_unknown\` (DNS/TLS/Connect error) | ${stateCounts.unavailable_unknown} |\n`;
  md += `| \`unsafe_destination_rejected\` (Private/Internal/Non-Global) | ${stateCounts.unsafe_destination_rejected} |\n`;
  md += `| \`unattempted_due_to_limits\` (Bound Exceeded) | ${stateCounts.unattempted_due_to_limits} |\n\n`;

  if (attentionList.length > 0) {
    md += `### Attention List (Sample Non-Reachable / Observed States)\n\n`;
    md += `| URL | State | Status / Details |\n`;
    md += `| --- | --- | --- |\n`;
    for (const item of attentionList) {
      const statusDisp = item.statusCode !== null ? item.statusCode : '-';
      const detailDisp = item.detail ? ` (${item.detail})` : '';
      const locDisp = item.location ? ` -> \`${item.location}\`` : '';
      md += `| \`${item.url}\` | \`${item.state}\` | \`${statusDisp}\`${locDisp}${detailDisp} |\n`;
    }
    md += `\n`;
  }

  md += `> ⚠️ **Notice:** Results reflect observed reachability from the GitHub runner network environment. Third-party bot, firewall, rate-limiting, or geographic policy controls may differ from human browser interaction.\n`;

  return md;
}

export async function runExternalLinkProbe({
  siteId,
  siteonePath = 'artifacts/raw/siteone.json',
  outputPath = 'artifacts/external-links.json',
  summaryPath = null,
  dnsResolver = null,
  transportFn = null,
  sleepFn = null,
} = {}) {
  const target = resolveTarget(siteId);

  if (!fs.existsSync(siteonePath)) {
    throw new Error(`SiteOne evidence file not found at ${siteonePath}`);
  }

  const rawText = fs.readFileSync(siteonePath, 'utf8');
  const siteoneJson = JSON.parse(rawText);

  const siteoneVersion = siteoneJson.crawler?.version || '2.5.1';
  const inputDigest = `sha256:${crypto.createHash('sha256').update(rawText).digest('hex')}`;

  const items = extractExternalUrlsFromSiteOne(siteoneJson);

  const { coverageCompleteness, results } = await processAllProbesWithBounds(items, {
    dnsResolver,
    transportFn,
    sleepFn,
  });

  let totalAttempted = 0;
  let totalRejected = 0;
  let totalUnattempted = 0;

  for (const r of results) {
    if (r.state === 'unsafe_destination_rejected') {
      totalRejected++;
    } else if (r.state === 'unattempted_due_to_limits') {
      totalUnattempted++;
    } else {
      totalAttempted++;
    }
  }

  const sidecarData = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    schemaMinorVersion: SIDECAR_SCHEMA_MINOR,
    siteId,
    target,
    siteoneVersion,
    executedAt: new Date().toISOString(),
    inputDigest,
    bounds: { ...HARD_BOUNDS },
    counts: {
      totalDiscovered: items.length,
      totalAttempted,
      totalRejected,
      totalUnattempted,
    },
    coverageCompleteness,
    results,
  };

  const jsonText = JSON.stringify(sidecarData, null, 2);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, jsonText, 'utf8');
  }

  const summaryMd = renderExternalLinksSummary(sidecarData);

  if (summaryPath) {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, summaryMd, 'utf8');
  }

  return { sidecarData, summaryMd };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.dirname, 'probe-external-links.mjs')) {
  const args = process.argv.slice(2);
  let siteId = null;
  let siteonePath = 'artifacts/raw/siteone.json';
  let outputPath = 'artifacts/external-links.json';
  let summaryPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--site-id' && args[i + 1]) {
      siteId = args[i + 1];
      i++;
    } else if (args[i] === '--siteone' && args[i + 1]) {
      siteonePath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--summary' && args[i + 1]) {
      summaryPath = args[i + 1];
      i++;
    }
  }

  if (!siteId) {
    console.error('Usage: node scripts/probe-external-links.mjs --site-id <WQT_SITE_ID> [--siteone <raw.json>] [--output <out.json>] [--summary <summary.md>]');
    process.exit(2);
  }

  runExternalLinkProbe({ siteId, siteonePath, outputPath, summaryPath })
    .then(({ summaryMd }) => {
      console.log(summaryMd);
    })
    .catch((err) => {
      console.error(`External link probe failed: ${err.message}`);
      process.exit(1);
    });
}
