import fs from 'node:fs';
import path from 'node:path';
import { SITE_ID_PATTERN } from './resolve-target.mjs';

const FACT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FACT_UNIT_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const FACT_VALUE_TYPES = new Set(['number', 'text', 'boolean']);
const FACT_ALLOWED_KEYS = new Set(['id', 'valueType', 'value', 'unit']);
const COUNT_FACT_IDS = new Set(['affected-resource-count', 'redirect-count']);
const MAX_FACTS_PER_FINDING = 8;
const MAX_TEXT_CODE_UNITS = 256;
const STATIC_CONTENT_TYPE_IDS = new Set([2, 3, 4, 5, 6, 7, 11]);
const CACHE_FLAG_NO_CACHE = 1024;
const CACHE_FLAG_NO_STORE = 2048;
const CACHE_FLAG_NO_CACHE_HEADERS = 32768;
const SHORT_CACHE_SECONDS = 86400;

function usage() {
  return 'Usage: node scripts/normalize.mjs --site-id <id> --target <url> --siteone <file> --lighthouse <file> --output <file>';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(usage());
    args[key.slice(2)] = value;
  }
  for (const required of ['site-id', 'target', 'siteone', 'lighthouse', 'output']) {
    if (!args[required]) throw new Error(`Missing --${required}. ${usage()}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertObject(value, name) {
  if (!isPlainObject(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
}

function asciiCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function hasFlag(value, flag) {
  return Math.floor(value / flag) % 2 === 1;
}

function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function validateFacts(facts) {
  if (!Array.isArray(facts)) throw new Error('facts must be an array');
  if (facts.length > MAX_FACTS_PER_FINDING) {
    throw new Error(`facts must contain no more than ${MAX_FACTS_PER_FINDING} entries`);
  }

  const seenIds = new Set();
  const validated = facts.map((fact, index) => {
    if (!isPlainObject(fact)) throw new Error(`fact[${index}] must be a JSON object`);

    for (const key of Object.keys(fact)) {
      if (!FACT_ALLOWED_KEYS.has(key)) throw new Error(`fact[${index}] has unexpected key: ${key}`);
    }
    for (const key of ['id', 'valueType', 'value']) {
      if (!Object.prototype.hasOwnProperty.call(fact, key)) throw new Error(`fact[${index}] is missing required key: ${key}`);
    }

    if (typeof fact.id !== 'string' || !FACT_ID_PATTERN.test(fact.id)) {
      throw new Error(`fact[${index}].id must match ${FACT_ID_PATTERN}`);
    }
    if (seenIds.has(fact.id)) throw new Error(`duplicate fact id: ${fact.id}`);
    seenIds.add(fact.id);

    if (!FACT_VALUE_TYPES.has(fact.valueType)) {
      throw new Error(`fact[${index}].valueType must be one of: number, text, boolean`);
    }

    if (Object.prototype.hasOwnProperty.call(fact, 'unit')) {
      if (typeof fact.unit !== 'string' || !FACT_UNIT_PATTERN.test(fact.unit)) {
        throw new Error(`fact[${index}].unit must match ${FACT_UNIT_PATTERN}`);
      }
    }

    if (fact.value !== null) {
      if (fact.valueType === 'number') {
        if (typeof fact.value !== 'number' || !Number.isFinite(fact.value) || Math.abs(fact.value) > Number.MAX_SAFE_INTEGER) {
          throw new Error(`fact[${index}].value must be a finite number within Number.MAX_SAFE_INTEGER`);
        }
      } else if (fact.valueType === 'text') {
        if (typeof fact.value !== 'string' || fact.value.length > MAX_TEXT_CODE_UNITS) {
          throw new Error(`fact[${index}].value must be a string of at most ${MAX_TEXT_CODE_UNITS} code units`);
        }
      } else if (typeof fact.value !== 'boolean') {
        throw new Error(`fact[${index}].value must be a boolean`);
      }
    }

    if (COUNT_FACT_IDS.has(fact.id)) {
      if (fact.valueType !== 'number' || fact.unit !== 'count') {
        throw new Error(`${fact.id} must use valueType "number" and unit "count"`);
      }
      if (fact.value !== null) assertNonNegativeSafeInteger(fact.value, `${fact.id}.value`);
    }

    return { ...fact };
  });

  return validated.sort((a, b) => asciiCompare(a.id, b.id));
}

function normalizedHostname(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!parsed.hostname) throw new Error(`${label} must include a hostname`);
  return parsed.hostname.startsWith('www.') ? parsed.hostname.slice(4) : parsed.hostname;
}

function tryNormalizedResultHostname(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return null;
    return parsed.hostname.startsWith('www.') ? parsed.hostname.slice(4) : parsed.hostname;
  } catch {
    return null;
  }
}

function extractStaticShortCacheFacts(raw, target) {
  if (!Array.isArray(raw.results)) {
    throw new Error('static-assets-short-cache requires SiteOne results[]');
  }

  const targetHostname = normalizedHostname(target, 'target');
  let count = 0;

  for (const result of raw.results) {
    if (!isPlainObject(result)) continue;
    const resultHostname = tryNormalizedResultHostname(result.url);
    if (resultHostname === null) continue;
    if (result.status !== '200') continue;
    if (resultHostname !== targetHostname) continue;
    if (!STATIC_CONTENT_TYPE_IDS.has(result.type)) continue;

    assertNonNegativeSafeInteger(result.cacheTypeFlags, 'SiteOne result cacheTypeFlags');
    if (result.cacheLifetime !== null) {
      assertNonNegativeSafeInteger(result.cacheLifetime, 'SiteOne result cacheLifetime');
    }

    if (hasFlag(result.cacheTypeFlags, CACHE_FLAG_NO_STORE)
      || hasFlag(result.cacheTypeFlags, CACHE_FLAG_NO_CACHE_HEADERS)) {
      continue;
    }

    if (hasFlag(result.cacheTypeFlags, CACHE_FLAG_NO_CACHE)
      || result.cacheLifetime === null
      || result.cacheLifetime < SHORT_CACHE_SECONDS) {
      count += 1;
    }
  }

  return validateFacts([{
    id: 'affected-resource-count',
    valueType: 'number',
    value: count,
    unit: 'count',
  }]);
}

function extractRedirectFacts(raw) {
  if (!isPlainObject(raw.tables)
    || !isPlainObject(raw.tables.redirects)
    || !Array.isArray(raw.tables.redirects.rows)) {
    throw new Error('redirects requires SiteOne tables.redirects.rows[]');
  }

  for (const [index, row] of raw.tables.redirects.rows.entries()) {
    if (!isPlainObject(row)) throw new Error(`redirect row[${index}] must be a JSON object`);
    for (const key of ['statusCode', 'url', 'targetUrl', 'sourceUqId']) {
      if (typeof row[key] !== 'string') throw new Error(`redirect row[${index}].${key} must be a string`);
    }
    if (!/^30[1-8]$/.test(row.statusCode)) {
      throw new Error(`redirect row[${index}].statusCode must be a redirect status from 301 through 308`);
    }
  }

  return validateFacts([{
    id: 'redirect-count',
    valueType: 'number',
    value: raw.tables.redirects.rows.length,
    unit: 'count',
  }]);
}

function extractSiteOneFacts(raw, target, code) {
  if (code === 'static-assets-short-cache') return extractStaticShortCacheFacts(raw, target);
  if (code === 'redirects') return extractRedirectFacts(raw);
  return undefined;
}

function normalizeSiteOne(raw, target) {
  assertObject(raw, 'SiteOne report');
  assertObject(raw.crawler, 'SiteOne crawler metadata');
  if (!Array.isArray(raw.summary?.items)) throw new Error('SiteOne report is missing summary.items');

  const categories = Array.isArray(raw.qualityScores?.categories)
    ? raw.qualityScores.categories.map((item) => ({
        code: item.code ?? null,
        name: item.name ?? null,
        score: item.score ?? null,
        label: item.label ?? null,
      })).sort((a, b) => String(a.code).localeCompare(String(b.code)))
    : [];

  const observations = raw.summary.items.map((item) => {
    const observation = {
      source: 'siteone',
      code: item.aplCode ?? null,
      sourceStatus: item.status ?? null,
      message: item.text ?? null,
    };
    const facts = extractSiteOneFacts(raw, target, observation.code);
    if (facts !== undefined) observation.facts = facts;
    return observation;
  }).sort((a, b) => `${a.sourceStatus}:${a.code}`.localeCompare(`${b.sourceStatus}:${b.code}`));

  return {
    tool: 'SiteOne Crawler',
    version: raw.crawler.version ?? null,
    executedAt: raw.crawler.executedAt ?? null,
    command: raw.crawler.command ?? null,
    overallScore: raw.qualityScores?.overall?.score ?? null,
    categoryScores: categories,
    observations,
  };
}

function normalizeLighthouse(raw) {
  assertObject(raw, 'Lighthouse report');
  if (!raw.lighthouseVersion) throw new Error('Lighthouse report is missing lighthouseVersion');
  if (!raw.audits || typeof raw.audits !== 'object') throw new Error('Lighthouse report is missing audits');

  const categories = Object.entries(raw.categories ?? {}).map(([id, item]) => ({
    id,
    title: item?.title ?? null,
    score: item?.score ?? null,
  })).sort((a, b) => a.id.localeCompare(b.id));

  const observations = Object.entries(raw.audits).map(([id, audit]) => ({
    source: 'lighthouse',
    code: id,
    title: audit?.title ?? null,
    score: audit?.score ?? null,
    scoreDisplayMode: audit?.scoreDisplayMode ?? null,
    displayValue: audit?.displayValue ?? null,
    numericValue: audit?.numericValue ?? null,
    numericUnit: audit?.numericUnit ?? null,
  })).sort((a, b) => a.code.localeCompare(b.code));

  return {
    tool: 'Lighthouse',
    version: raw.lighthouseVersion,
    fetchTime: raw.fetchTime ?? null,
    requestedUrl: raw.requestedUrl ?? null,
    finalUrl: raw.finalUrl ?? null,
    userAgent: raw.userAgent ?? null,
    categoryScores: categories,
    observations,
  };
}

// Evidence schema versioning decision:
// `schemaVersion` remains the v1 major contract. Minor 2 adds only bounded,
// optional typed SiteOne facts; downstream consumers must opt into minor 2
// semantics deliberately. Historical minor-1 artifacts are not rewritten.
const SCHEMA_VERSION = 'ldw.website-quality.v1';
const SCHEMA_MINOR_VERSION = 2;

export function normalizeEvidence({ siteId, target, siteone, lighthouse }) {
  if (typeof siteId !== 'string' || !SITE_ID_PATTERN.test(siteId)) {
    throw new Error('siteId must be a valid opaque site identifier matching ^[a-z0-9][a-z0-9-]{0,63}$');
  }

  const siteoneNormalized = normalizeSiteOne(siteone, target);
  const lighthouseNormalized = normalizeLighthouse(lighthouse);
  return {
    schemaVersion: SCHEMA_VERSION,
    schemaMinorVersion: SCHEMA_MINOR_VERSION,
    siteId,
    target,
    evidenceOnly: true,
    gatePolicy: {
      qualityThresholdsApplied: false,
      siteOneCiModeEnabled: false,
    },
    sources: {
      siteone: siteoneNormalized,
      lighthouse: lighthouseNormalized,
    },
    observations: [...siteoneNormalized.observations, ...lighthouseNormalized.observations]
      .sort((a, b) => `${a.source}:${a.code}`.localeCompare(`${b.source}:${b.code}`)),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const normalized = normalizeEvidence({
      siteId: args['site-id'],
      target: args.target,
      siteone: readJson(args.siteone),
      lighthouse: readJson(args.lighthouse),
    });
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, `${JSON.stringify(normalized, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
