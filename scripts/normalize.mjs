import fs from 'node:fs';
import path from 'node:path';

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

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
}

function normalizeSiteOne(raw) {
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

  const observations = raw.summary.items.map((item) => ({
    source: 'siteone',
    code: item.aplCode ?? null,
    sourceStatus: item.status ?? null,
    message: item.text ?? null,
  })).sort((a, b) => `${a.sourceStatus}:${a.code}`.localeCompare(`${b.sourceStatus}:${b.code}`));

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

// Evidence schema versioning decision (Baseline 0.3):
//   `schemaVersion` identifies the major, potentially-breaking evidence shape
//   ("ldw.website-quality.v1") and is unchanged from Baseline 0.1/0.2 because no
//   existing field was removed, renamed, or given new meaning.
//   `schemaMinorVersion` is a separate, purely additive counter. It starts at 0
//   for the original Baseline 0.1/0.2 shape (implicit) and increments to 1 for
//   Baseline 0.3's addition of `siteId`. Consumers that do not recognize
//   `schemaMinorVersion` can safely ignore it; consumers that need the new
//   field should check `schemaMinorVersion >= 1` rather than parsing
//   `schemaVersion` as a compound string. A future breaking change must bump
//   `schemaVersion` (e.g. `.v2`) and reset `schemaMinorVersion`, not overload
//   the minor counter.
const SCHEMA_VERSION = 'ldw.website-quality.v1';
const SCHEMA_MINOR_VERSION = 1;

export function normalizeEvidence({ siteId, target, siteone, lighthouse }) {
  if (typeof siteId !== 'string' || siteId.trim() === '') {
    throw new Error('siteId must be a non-empty string');
  }

  const siteoneNormalized = normalizeSiteOne(siteone);
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
