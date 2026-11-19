import { createHash } from 'node:crypto';

export const MAX_OFFLINE_PSI_BYTES = 8 * 1024 * 1024;
export const MAX_PSI_SELECTED_AUDITS = 3;
const CATEGORY_IDS = Object.freeze(['performance', 'accessibility', 'best-practices', 'seo']);
const SCORE_MODES = new Set(['binary', 'numeric', 'informative', 'manual', 'notApplicable', 'error', 'SCORE_DISPLAY_MODE_UNSPECIFIED']);
const RESERVED = new Set(['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'arpa', 'onion']);
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export class OfflinePsiPreviewError extends Error {
  constructor() {
    super('Invalid or unverified offline PageSpeed preview input.');
    this.name = 'OfflinePsiPreviewError';
  }
}
function fail() {
  throw new OfflinePsiPreviewError();
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundedText(value, max = 160) {
  if (typeof value !== 'string' || value.length > 4096) fail();
  // Presentation-only excerpt; do not render as trusted HTML or Markdown.
  const compact = value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return compact.length > max ? compact.slice(0, max) + '…' : compact;
}
function origin(value) {
  if (typeof value !== 'string' || value.length > 320 || value.length === 0
      || /[^\x21-\x7e]/.test(value) || /[\\@%?#\[\]]/.test(value)) fail();
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
      || url.pathname !== '/' || url.search || url.hash || url.hostname.endsWith('.')) fail();
  const labels = url.hostname.split('.');
  if (labels.length < 2 || labels.some((part) => !LABEL.test(part))
      || labels.some((part) => part.startsWith('xn--'))
      || RESERVED.has(labels.at(-1)) || !/^[a-z]{2,63}$/.test(labels.at(-1))) fail();
  // URL() silently folds explicit :443, host casing and dot segments.
  // Admit only the two literal canonical homepage notations; the digest is
  // not authorization and a normalized alias must not pass source identity.
  if (value !== url.origin && value !== `${url.origin}/`) fail();
  return url.origin;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) fail();
  return value;
}
function nativeScore(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail();
  return value; // Source-native 0..1. No LDW grade or unscored-as-zero conversion.
}
function parseOptions(options) {
  if (!record(options) || Object.getPrototypeOf(options) !== Object.prototype) fail();
  const keys = Object.keys(options);
  if (keys.some((key) => !['expectedOrigin', 'expectedFormFactor', 'selectedAuditIds'].includes(key))) fail();
  const expectedOrigin = origin(options.expectedOrigin);
  const formFactor = options.expectedFormFactor;
  if (formFactor !== 'mobile' && formFactor !== 'desktop') fail();
  const selected = options.selectedAuditIds ?? [];
  if (!Array.isArray(selected) || selected.length > MAX_PSI_SELECTED_AUDITS) fail();
  const ids = new Set();
  for (const id of selected) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,96}$/.test(id) || ids.has(id)) fail();
    ids.add(id);
  }
  return { expectedOrigin, formFactor, selected };
}

/**
 * Strict, offline projection of untrusted already-held PSI v5 response bytes.
 *
 * The byte hash is identity, NOT source authenticity. No request/connection
 * credential, Google origin proof, page scan authorization, output publication
 * or prospect email permission is implied by a successfully parsed response.
 */
export function projectOfflinePsiPreview(rawBytes, trustedOptions) {
  try {
    if (!(rawBytes instanceof Uint8Array) || rawBytes.byteLength === 0
        || rawBytes.byteLength > MAX_OFFLINE_PSI_BYTES) fail();
    const { expectedOrigin, formFactor, selected } = parseOptions(trustedOptions);
    const json = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBytes);
    const data = JSON.parse(json);
    if (!record(data) || data.kind !== 'pagespeedonline#result'
        || !record(data.lighthouseResult) || origin(data.id) !== expectedOrigin) fail();
    const lhr = data.lighthouseResult;
    if (origin(lhr.requestedUrl) !== expectedOrigin || origin(lhr.finalUrl) !== expectedOrigin) fail();
    if (!record(lhr.configSettings)) fail();
    const actualFormFactor = lhr.configSettings.formFactor ?? lhr.configSettings.emulatedFormFactor;
    if (actualFormFactor !== formFactor) fail();
    if (lhr.configSettings.formFactor !== undefined
        && lhr.configSettings.emulatedFormFactor !== undefined
        && lhr.configSettings.formFactor !== lhr.configSettings.emulatedFormFactor) fail();
    if (lhr.runtimeError && lhr.runtimeError.code !== 'NO_ERROR') fail();
    if (!record(lhr.categories)) fail();
    if (typeof lhr.lighthouseVersion !== 'string' || lhr.lighthouseVersion.length > 80
        || !/^\d+\.\d+(?:\.\d+)?(?:[-.a-z0-9]+)?$/i.test(lhr.lighthouseVersion)) fail();

    const categories = CATEGORY_IDS.map((id) => {
      const source = Object.hasOwn(lhr.categories, id) ? lhr.categories[id] : undefined;
      if (source === undefined) return Object.freeze({ id, state: 'not_provided', score: null });
      if (!record(source) || (source.id !== undefined && source.id !== id)) fail();
      const score = nativeScore(source.score);
      return Object.freeze({ id, state: score === null ? 'unscored' : 'scored', score });
    });

    if (selected.length > 0 && !record(lhr.audits)) fail();
    const audits = selected.map((id) => {
      if (!Object.hasOwn(lhr.audits, id)) fail();
      const raw = lhr.audits[id];
      if (!record(raw) || (raw.id !== undefined && raw.id !== id)
          || !SCORE_MODES.has(raw.scoreDisplayMode)) fail();
      const score = nativeScore(raw.score);
      if (raw.scoreDisplayMode !== 'binary' && raw.scoreDisplayMode !== 'numeric'
          && score !== null) fail();
      return Object.freeze({
        id,
        sourceTitle: boundedText(raw.title),
        sourceScoreDisplayMode: raw.scoreDisplayMode,
        sourceScore: score,
        sourceDisplayValue: raw.displayValue === undefined || raw.displayValue === null
          ? null : boundedText(raw.displayValue, 120),
      });
    });

    return Object.freeze({
      kind: 'ldw.wqt-psi-offline-preview.v0',
      provider: 'google-pagespeed-insights-v5',
      expectedOrigin,
      sourceFormFactor: actualFormFactor,
      sourceFetchedAt: timestamp(lhr.fetchTime),
      sourceLighthouseVersion: lhr.lighthouseVersion,
      sourceSha256: createHash('sha256').update(rawBytes).digest('hex'),
      categories: Object.freeze(categories),
      selectedAudits: Object.freeze(audits),
      sourceWarningsPresent: Array.isArray(lhr.runWarnings) && lhr.runWarnings.length > 0,
      fieldDataIncluded: false, // CrUX is ignored; Google plans to discontinue PSI CrUX.
      sourceVerified: false,
      networkAuthorized: false,
      deliveryAuthorized: false,
    });
  } catch {
    // Do not echo URLs, raw responses, arbitrary source strings or customer data.
    fail();
  }
}
