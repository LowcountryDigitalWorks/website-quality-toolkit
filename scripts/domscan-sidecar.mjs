import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { SITE_ID_PATTERN } from './resolve-target.mjs';

export const SCHEMA_VERSION = 'ldw.wqt-domscan-sidecar.v1';
export const PROVIDER = 'domscan';
export const MAX_INPUT_BYTES = 262_144;
export const MAX_STRING = 256;
export const MAX_CAVEATS = 8;

const DNS_CHECKS = [
  'spf',
  'dkim',
  'dmarc',
  'dnssec',
  'caa',
  'mta_sts',
  'tls_rpt',
  'zone_transfer',
];

/** Provider `agent_readiness.signals` keys (Nov 2026 DomScan contract). */
export const AGENT_SIGNALS = [
  'webmcp',
  'remote_mcp',
  'openapi',
  'llms_txt',
  'api_catalog',
  'mcp_server_card',
  'agent_skills',
  'oauth',
  'markdown',
  'web_bot_auth',
  'sitemap_markdown',
  'agent_guide',
];

const CLASSIFICATIONS = new Set([
  'present',
  'absent',
  'unknown',
  'not_detected',
  'not_applicable',
  'inconclusive',
]);

const AGENT_OUTCOMES = new Set(['partial', 'complete', 'success', 'failed', 'error', 'unknown']);

const DMARC_POLICIES = new Set(['none', 'quarantine', 'reject']);

const CAVEAT_TOKEN = /^[a-z][a-z0-9_]{0,63}$/;

const ISO_UTC_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const EMAIL_LIKE = /@|mailto:/i;

function usage() {
  return 'Usage: node scripts/domscan-sidecar.mjs --site-id <id> --origin <https-url> --endpoint dns_security|agent_readiness --input <file> --output <file>';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(usage());
    args[key.slice(2)] = value;
  }
  for (const required of ['site-id', 'origin', 'endpoint', 'input', 'output']) {
    if (!args[required]) throw new Error(`Missing --${required}. ${usage()}`);
  }
  return args;
}

function assertString(value, label, { max = MAX_STRING, pattern = null } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error(`${label} exceeds maximum length`);
  if (pattern && !pattern.test(trimmed)) throw new Error(`${label} has invalid shape`);
  return trimmed;
}

export function assertIsoUtc(value, label) {
  const text = assertString(value, label, { max: 64 });
  if (!ISO_UTC_Z.test(text)) throw new Error(`${label} must be UTC ISO-8601 with millisecond Z suffix`);
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a legitimate calendar time`);
  if (new Date(parsed).toISOString() !== text) throw new Error(`${label} must be a legitimate calendar time`);
  return text;
}

export function parseHttpsOrigin(value) {
  const text = assertString(value, 'origin', { max: 512 });
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('origin must be a valid URL');
  }
  if (url.protocol !== 'https:' || !url.hostname) throw new Error('origin must be https with a hostname');
  if (url.username || url.password) throw new Error('origin must not include credentials');
  if (url.search || url.hash) throw new Error('origin must not include query or hash');
  if (url.port && url.port !== '443') throw new Error('origin must not specify a non-default port');
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('origin must be a bare https origin without path, query, or credentials');
  }
  const host = url.hostname.toLowerCase();
  return { origin: `https://${host}`, host };
}

export function assertRootHttpsUrl(value, label, canonical) {
  const text = assertString(value, label, { max: 512 });
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use https`);
  if (url.username || url.password) throw new Error(`${label} must not include credentials`);
  if (url.search || url.hash) throw new Error(`${label} must not include query or hash`);
  if (url.port && url.port !== '443') throw new Error(`${label} must not include a non-default port`);
  if (url.hostname.toLowerCase() !== canonical.host) throw new Error('requested_url/final_url host must match origin host');
  if (url.pathname !== '/') throw new Error(`${label} must be the canonical site root path`);
  const allowed = `${canonical.origin}/`;
  if (text !== allowed) throw new Error(`${label} must exactly match canonical origin root`);
  return allowed;
}

export function readBoundedJson(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(MAX_INPUT_BYTES + 1);
    const bytesRead = fs.readSync(fd, buf, 0, MAX_INPUT_BYTES + 1, 0);
    if (bytesRead > MAX_INPUT_BYTES) throw new Error('input file exceeds size bound');
    const text = buf.toString('utf8', 0, bytesRead);
    return JSON.parse(text);
  } finally {
    fs.closeSync(fd);
  }
}

function forbidLeaks(value) {
  const text = JSON.stringify(value);
  if (EMAIL_LIKE.test(text)) throw new Error('sanitized output must not contain email-like content');
  if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text)) throw new Error('sanitized output must not contain raw IPv4 literals');
}

function normalizeClassification(status, { inconclusive = false } = {}) {
  if (inconclusive) return 'inconclusive';
  if (status === null || status === undefined) return 'unknown';
  const text = String(status).toLowerCase();
  if (CLASSIFICATIONS.has(text)) return text;
  if (text === 'not detected' || text === 'not_detected') return 'not_detected';
  throw new Error(`unsupported classification status: ${status}`);
}

function classificationFromNested(entry) {
  if (!entry || typeof entry !== 'object') return 'unknown';
  if (entry.classification?.status !== undefined) return normalizeClassification(entry.classification.status);
  if (entry.exists === false) return 'absent';
  if (entry.exists === true) return 'present';
  if (entry.exposed === null) return 'inconclusive';
  if (entry.exposed === true) return 'present';
  if (entry.exposed === false) return 'absent';
  if (entry.status !== undefined) return normalizeClassification(entry.status);
  if (entry.valid === true) return 'present';
  if (entry.valid === false) return 'absent';
  return 'unknown';
}

function boundedCaveats(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('caveats must be an array');
  if (value.length > MAX_CAVEATS) throw new Error('caveats exceed bound');
  return value.map((item, index) => {
    const token = assertString(item, `caveats[${index}]`, { max: 64, pattern: CAVEAT_TOKEN });
    return token;
  });
}

function assertHostMatch(inputHost, originHost) {
  const host = assertString(inputHost, 'input host', { max: 253 }).toLowerCase();
  if (host !== originHost) throw new Error('input host does not match origin host');
  return host;
}

function assertAgentScore(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error('agent readiness score must be an integer from 0 to 100');
  }
  return score;
}

export function sanitizeDnsSecurity(input, { siteId, origin }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('dns_security input must be an object');
  const canonical = parseHttpsOrigin(origin);
  const opaqueSiteId = assertString(siteId, 'siteId', { pattern: SITE_ID_PATTERN });
  assertHostMatch(input.domain, canonical.host);
  const observedAt = assertIsoUtc(input.checked_at, 'checked_at');

  const checks = [];
  for (const code of DNS_CHECKS) {
    if (!(code in input)) throw new Error(`dns_security missing required check ${code}`);
    const entry = input[code];
    const check = { code, classification: classificationFromNested(entry) };
    if (code === 'spf' && entry?.valid === true) check.valid = true;
    if (code === 'spf' && entry?.valid === false) check.valid = false;
    if (code === 'dmarc' && typeof entry?.policy === 'string') {
      const policy = assertString(entry.policy, 'dmarc.policy', { max: 32 }).toLowerCase();
      if (!DMARC_POLICIES.has(policy)) throw new Error('dmarc.policy has invalid value');
      check.policy = policy;
    }
    if (code === 'zone_transfer' && entry?.exposed === null) check.classification = 'inconclusive';
    checks.push(check);
  }

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    provider: PROVIDER,
    evidenceOnly: true,
    gatePolicy: { qualityThresholdsApplied: false, domscanSidecar: true },
    siteId: opaqueSiteId,
    origin: canonical.origin,
    endpoint: 'dns_security',
    inputObservedAt: observedAt,
    checks,
  };
  forbidLeaks(artifact);
  return artifact;
}

export function sanitizeAgentReadiness(input, { siteId, origin }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('agent_readiness input must be an object');
  const canonical = parseHttpsOrigin(origin);
  const opaqueSiteId = assertString(siteId, 'siteId', { pattern: SITE_ID_PATTERN });
  assertRootHttpsUrl(input.requested_url, 'requested_url', canonical);
  assertRootHttpsUrl(input.final_url, 'final_url', canonical);
  const observedAt = assertIsoUtc(input.checked_at, 'checked_at');
  if (!input.signals || typeof input.signals !== 'object' || Array.isArray(input.signals)) {
    throw new Error('signals must be an object');
  }

  const outcome = assertString(input.outcome ?? 'unknown', 'outcome', { max: 32 }).toLowerCase();
  if (!AGENT_OUTCOMES.has(outcome)) throw new Error('outcome has invalid value');

  const signals = [];
  for (const code of AGENT_SIGNALS) {
    const raw = input.signals[code];
    if (raw === undefined || raw === null) {
      signals.push({ code, classification: 'unknown' });
      continue;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`signals.${code} must be an object`);
    const item = {
      code,
      classification: classificationFromNested(raw),
    };
    if (raw.validation !== undefined) {
      item.validation = assertString(raw.validation, `${code}.validation`, { max: 64, pattern: /^[a-z][a-z0-9_]*$/ });
    }
    if (raw.method !== undefined) {
      item.method = assertString(raw.method, `${code}.method`, { max: 64, pattern: /^[a-z][a-z0-9_]*$/ });
    }
    const caveats = boundedCaveats(raw.caveats);
    if (caveats) item.caveats = caveats;
    if (code === 'webmcp' && raw.validation === 'runtime_required') {
      item.classification = 'unknown';
    }
    signals.push(item);
  }
  signals.sort((a, b) => a.code.localeCompare(b.code));

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    provider: PROVIDER,
    evidenceOnly: true,
    gatePolicy: { qualityThresholdsApplied: false, domscanSidecar: true },
    siteId: opaqueSiteId,
    origin: canonical.origin,
    endpoint: 'agent_readiness',
    requestedRootUrl: `${canonical.origin}/`,
    finalRootUrl: `${canonical.origin}/`,
    inputObservedAt: observedAt,
    outcome,
    signals,
  };
  if (input.summary && typeof input.summary === 'object' && input.summary.score !== undefined) {
    artifact.sourceNative = { agentReadinessScore: assertAgentScore(input.summary.score) };
  }
  forbidLeaks(artifact);
  return artifact;
}

export function sanitizeDomscanEndpoint(input, context) {
  const endpoint = assertString(context.endpoint, 'endpoint', { max: 64 });
  if (endpoint === 'dns_security') return sanitizeDnsSecurity(input, context);
  if (endpoint === 'agent_readiness') return sanitizeAgentReadiness(input, context);
  throw new Error('endpoint must be dns_security or agent_readiness');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { origin } = parseHttpsOrigin(args.origin);
  const endpoint = assertString(args.endpoint, 'endpoint');
  const input = readBoundedJson(path.resolve(args.input));
  const artifact = sanitizeDomscanEndpoint(input, {
    siteId: args['site-id'],
    origin,
    endpoint,
  });
  const outPath = path.resolve(args.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
