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

const AGENT_SIGNALS = ['webmcp', 'remote_mcp', 'llms_txt', 'robots_ai', 'sitemap_ai', 'json_ld', 'microdata'];

const CLASSIFICATIONS = new Set([
  'present',
  'absent',
  'unknown',
  'not_detected',
  'not_applicable',
  'inconclusive',
]);

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

function assertIsoUtc(value, label) {
  const text = assertString(value, label, { max: 64 });
  if (Number.isNaN(Date.parse(text))) throw new Error(`${label} must be a valid ISO timestamp`);
  return text;
}

function parseHttpsOrigin(value) {
  const text = assertString(value, 'origin', { max: 512 });
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('origin must be a valid URL');
  }
  if (url.protocol !== 'https:' || !url.hostname) throw new Error('origin must be https with a hostname');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('origin must be a bare https origin without path, query, or credentials');
  }
  return { origin: `${url.protocol}//${url.hostname}`, host: url.hostname.toLowerCase() };
}

function readBoundedJson(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('input file is missing or exceeds size bound');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  return 'unknown';
}

function boundedCaveats(value) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('caveats must be an array');
  if (value.length > MAX_CAVEATS) throw new Error('caveats exceed bound');
  return value.map((item, index) => assertString(item, `caveats[${index}]`, { max: 160 }));
}

function assertHostMatch(inputHost, originHost) {
  const host = assertString(inputHost, 'input host', { max: 253 }).toLowerCase();
  if (host !== originHost) throw new Error('input host does not match origin host');
  return host;
}

export function sanitizeDnsSecurity(input, { siteId, origin }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('dns_security input must be an object');
  const { host } = parseHttpsOrigin(origin);
  const opaqueSiteId = assertString(siteId, 'siteId', { pattern: SITE_ID_PATTERN });
  assertHostMatch(input.domain, host);
  const observedAt = assertIsoUtc(input.checked_at, 'checked_at');

  const checks = [];
  for (const code of DNS_CHECKS) {
    if (!(code in input)) throw new Error(`dns_security missing required check ${code}`);
    const entry = input[code];
    const check = { code, classification: classificationFromNested(entry) };
    if (code === 'spf' && entry?.valid === true) check.valid = true;
    if (code === 'spf' && entry?.valid === false) check.valid = false;
    if (code === 'dmarc' && typeof entry?.policy === 'string') {
      check.policy = assertString(entry.policy, 'dmarc.policy', { max: 32, pattern: /^[a-z0-9_-]+$/i });
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
    origin,
    endpoint: 'dns_security',
    inputObservedAt: observedAt,
    sourceObservedAt: new Date().toISOString(),
    checks,
  };
  forbidLeaks(artifact);
  return artifact;
}

export function sanitizeAgentReadiness(input, { siteId, origin }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('agent_readiness input must be an object');
  const { host } = parseHttpsOrigin(origin);
  const opaqueSiteId = assertString(siteId, 'siteId', { pattern: SITE_ID_PATTERN });
  const requested = assertString(input.requested_url, 'requested_url', { max: 512 });
  const finalUrl = assertString(input.final_url, 'final_url', { max: 512 });
  const reqHost = new URL(requested).hostname.toLowerCase();
  const finHost = new URL(finalUrl).hostname.toLowerCase();
  if (reqHost !== host || finHost !== host) throw new Error('requested_url/final_url host must match origin host');
  const observedAt = assertIsoUtc(input.checked_at, 'checked_at');
  if (!input.signals || typeof input.signals !== 'object') throw new Error('signals must be an object');

  const signals = [];
  for (const code of AGENT_SIGNALS) {
    if (!(code in input.signals)) continue;
    const raw = input.signals[code];
    const item = {
      code,
      classification: classificationFromNested(raw),
    };
    if (raw?.validation) item.validation = assertString(raw.validation, `${code}.validation`, { max: 64 });
    if (raw?.method) item.method = assertString(raw.method, `${code}.method`, { max: 64 });
    const caveats = boundedCaveats(raw?.caveats);
    if (caveats) item.caveats = caveats;
    if (code === 'webmcp' && raw?.validation === 'runtime_required') {
      item.classification = 'unknown';
    }
    if (
      code === 'json_ld'
      && (item.classification === 'absent' || item.classification === 'not_detected')
    ) {
      item.classification = 'unknown';
      item.note = 'static_signal_not_whole_site_structured_data';
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
    origin,
    endpoint: 'agent_readiness',
    inputObservedAt: observedAt,
    sourceObservedAt: new Date().toISOString(),
    outcome: assertString(input.outcome ?? 'unknown', 'outcome', { max: 32 }),
    signals,
  };
  if (input.summary && typeof input.summary.score === 'number' && Number.isFinite(input.summary.score)) {
    artifact.sourceNative = { agentReadinessScore: input.summary.score };
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
