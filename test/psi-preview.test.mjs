import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  MAX_OFFLINE_PSI_BYTES,
  MAX_PSI_SELECTED_AUDITS,
  OfflinePsiPreviewError,
  projectOfflinePsiPreview,
} from '../scripts/psi-preview.mjs';

function fixture() {
  return {
    kind: 'pagespeedonline#result',
    id: 'https://example.org/',
    loadingExperience: { metrics: { FAKE_FIELD_METRIC: { percentile: 999999 } } },
    lighthouseResult: {
      requestedUrl: 'https://example.org/',
      finalUrl: 'https://example.org/',
      fetchTime: '2026-11-14T22:20:30.000Z',
      lighthouseVersion: '13.0.0',
      configSettings: { formFactor: 'mobile' },
      categories: {
        performance: { id: 'performance', score: 0 },
        accessibility: { id: 'accessibility', score: null },
        seo: { id: 'seo', score: 0.91 },
      },
      audits: {
        'first-contentful-paint': {
          id: 'first-contentful-paint', scoreDisplayMode: 'numeric',
          score: 0, title: 'First Contentful Paint', displayValue: '3.4 s',
        },
        'is-on-https': {
          id: 'is-on-https', scoreDisplayMode: 'binary',
          score: 1, title: 'Uses HTTPS', displayValue: null,
        },
        'source-info': {
          id: 'source-info', scoreDisplayMode: 'informative',
          score: null, title: '<img src=x onerror=alert(1)> [link](https://evil.test) '.repeat(16),
          displayValue: 'https://evil.test/report',
        },
      },
      runWarnings: [],
    },
  };
}
const opts = {
  expectedOrigin: 'https://example.org',
  expectedFormFactor: 'mobile',
  selectedAuditIds: ['first-contentful-paint'],
};
function bytes(data) {
  return Buffer.from(JSON.stringify(data), 'utf8');
}
function output(data = fixture(), options = opts) {
  return projectOfflinePsiPreview(bytes(data), options);
}
function rejects(data, options = opts) {
  assert.throws(() => output(data, options), OfflinePsiPreviewError);
}

test('offline PSI projection preserves native score zero, unscored null and missing category', () => {
  const original = fixture();
  const source = bytes(original);
  const result = projectOfflinePsiPreview(source, opts);
  assert.equal(result.kind, 'ldw.wqt-psi-offline-preview.v0');
  assert.equal(result.provider, 'google-pagespeed-insights-v5');
  assert.equal(result.expectedOrigin, 'https://example.org');
  assert.equal(result.sourceFormFactor, 'mobile');
  assert.equal(result.sourceFetchedAt, original.lighthouseResult.fetchTime);
  assert.equal(result.sourceLighthouseVersion, '13.0.0');
  assert.equal(result.sourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(result.categories, [
    { id: 'performance', state: 'scored', score: 0 },
    { id: 'accessibility', state: 'unscored', score: null },
    { id: 'best-practices', state: 'not_provided', score: null },
    { id: 'seo', state: 'scored', score: 0.91 },
  ]);
  assert.deepEqual(result.selectedAudits, [{
    id: 'first-contentful-paint', sourceTitle: 'First Contentful Paint',
    sourceScoreDisplayMode: 'numeric', sourceScore: 0, sourceDisplayValue: '3.4 s',
  }]);
  assert.equal(result.fieldDataIncluded, false);
  assert.equal(result.sourceVerified, false);
  assert.equal(result.networkAuthorized, false);
  assert.equal(result.deliveryAuthorized, false);
  assert.equal('globalGrade' in result, false);
  assert.equal('lostRevenue' in result, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.categories), true);
  assert.equal(Object.isFrozen(result.categories[0]), true);
  assert.equal(Object.isFrozen(result.selectedAudits[0]), true);
});

test('offline PSI selection is human-specified, exact and excerpt-bound', () => {
  const a = output(fixture(), { ...opts, selectedAuditIds: ['is-on-https', 'source-info'] });
  assert.equal(a.selectedAudits.length, 2);
  assert.deepEqual(a.selectedAudits[0], {
    id: 'is-on-https', sourceTitle: 'Uses HTTPS',
    sourceScoreDisplayMode: 'binary', sourceScore: 1, sourceDisplayValue: null,
  });
  assert.ok(a.selectedAudits[1].sourceTitle.length <= 161);
  assert.equal(a.selectedAudits[1].sourceScore, null);
  assert.equal(a.selectedAudits[1].sourceDisplayValue, 'https://evil.test/report');
  assert.equal(MAX_PSI_SELECTED_AUDITS, 3);
  assert.deepEqual(output(fixture(), { ...opts, selectedAuditIds: [] }).selectedAudits, []);
  assert.throws(() => output(fixture(), { ...opts, selectedAuditIds: ['fake'] }), OfflinePsiPreviewError);
  assert.throws(() => output(fixture(), { ...opts, selectedAuditIds: ['source-info', 'source-info'] }), OfflinePsiPreviewError);
  assert.throws(() => output(fixture(), { ...opts, selectedAuditIds: ['x', 'y', 'z', 'w'] }), OfflinePsiPreviewError);
});

test('offline PSI rejects redirect, origin, source identity and strategy mismatches before reporting', () => {
  const mutated = [
    (v) => { v.id = 'https://evil.org/'; },
    (v) => { v.lighthouseResult.requestedUrl = 'https://evil.org/'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://evil.org/'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://example.org/private'; },
    (v) => { v.lighthouseResult.finalUrl = 'http://example.org/'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://127.0.0.1/'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://example.org:8443/'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://user:pw@example.org/'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://example.org/?redirect=evil'; },
    (v) => { v.lighthouseResult.finalUrl = 'https://münich.org/'; },
    (v) => { v.lighthouseResult.configSettings.formFactor = 'desktop'; },
    (v) => { v.lighthouseResult.configSettings.emulatedFormFactor = 'desktop'; },
    (v) => { v.lighthouseResult.configSettings.formFactor = 'other'; },
  ];
  for (const mutate of mutated) {
    const v = fixture();
    mutate(v);
    rejects(v);
  }
  assert.throws(() => output(fixture(), { ...opts, expectedOrigin: 'http://example.org' }), OfflinePsiPreviewError);
  assert.throws(() => output(fixture(), { ...opts, expectedOrigin: 'https://127.0.0.1' }), OfflinePsiPreviewError);
  assert.throws(() => output(fixture(), { ...opts, expectedOrigin: 'https://example.org/path' }), OfflinePsiPreviewError);
  assert.throws(() => output(fixture(), { ...opts, expectedFormFactor: 'tablet' }), OfflinePsiPreviewError);
  assert.throws(() => output(fixture(), { ...opts, testUnexpectedOption: 1 }), OfflinePsiPreviewError);
});

test('offline PSI runtime errors and invalid source scores never become healthy zero', () => {
  const invalid = [
    (v) => { v.lighthouseResult.runtimeError = { code: 'ERRORED_DOCUMENT_REQUEST' }; },
    (v) => { v.lighthouseResult.categories.performance.score = -0.1; },
    (v) => { v.lighthouseResult.categories.performance.score = 1.1; },
    (v) => { v.lighthouseResult.categories.performance.score = '0'; },
    (v) => { v.lighthouseResult.categories.performance.score = {}; },
    (v) => { v.lighthouseResult.categories.performance.id = 'seo'; },
    (v) => { v.lighthouseResult.categories.performance = 'zero'; },
    (v) => { v.lighthouseResult.audits['first-contentful-paint'].score = 3; },
    (v) => { v.lighthouseResult.audits['first-contentful-paint'].scoreDisplayMode = 'informative'; },
    (v) => { v.lighthouseResult.lighthouseVersion = '<script>'; },
    (v) => { v.lighthouseResult.fetchTime = 'unknown date'; },
    (v) => { v.kind = 'not-psi'; },
  ];
  for (const mutate of invalid) {
    const v = fixture();
    mutate(v);
    rejects(v);
  }
  const scoreModes = fixture();
  scoreModes.lighthouseResult.audits['first-contentful-paint'].score = null;
  assert.equal(output(scoreModes).selectedAudits[0].sourceScore, null);
  scoreModes.lighthouseResult.runtimeError = { code: 'NO_ERROR' };
  assert.equal(output(scoreModes).categories[0].score, 0);
});

test('Lighthouse canonical notApplicable mode is unscored, not an invalid PSI response', () => {
  const payload = fixture();
  payload.lighthouseResult.audits['first-contentful-paint'] = {
    id: 'first-contentful-paint',
    scoreDisplayMode: 'notApplicable',
    score: null,
    title: 'Not applicable under this source method',
    displayValue: null,
  };
  const result = output(payload);
  assert.equal(result.selectedAudits[0].sourceScoreDisplayMode, 'notApplicable');
  assert.equal(result.selectedAudits[0].sourceScore, null);
  assert.equal(result.selectedAudits[0].sourceDisplayValue, null);

  // A valid unscored display mode must never carry a numeric score.
  payload.lighthouseResult.audits['first-contentful-paint'].score = 0;
  rejects(payload);
  payload.lighthouseResult.audits['first-contentful-paint'].score = null;

  // The previously accepted snake_case spelling is not a Lighthouse mode.
  payload.lighthouseResult.audits['first-contentful-paint'].scoreDisplayMode = 'not_applicable';
  rejects(payload);
});

test('offline PSI bounds raw source bytes, malformed JSON and invalid UTF8 with non-echoing errors', () => {
  assert.equal(MAX_OFFLINE_PSI_BYTES, 8 * 1024 * 1024);
  const malformedInputs = [
    new Uint8Array(0),
    Buffer.from('{invalid', 'utf8'),
    Buffer.from([0x7b, 0xc3, 0x28, 0x7d]),
    Buffer.alloc(MAX_OFFLINE_PSI_BYTES + 1, 0x20),
    'not bytes',
    { kind: 'pagespeedonline#result' },
  ];
  for (const input of malformedInputs) {
    assert.throws(() => projectOfflinePsiPreview(input, opts),
      (error) => error instanceof OfflinePsiPreviewError
        && error.message === 'Invalid or unverified offline PageSpeed preview input.');
  }
  const hugeTitle = fixture();
  hugeTitle.lighthouseResult.audits['first-contentful-paint'].title = 'x'.repeat(4097);
  rejects(hugeTitle);
  const noField = fixture();
  delete noField.loadingExperience;
  assert.equal(output(noField).fieldDataIncluded, false);
});

test('offline PSI does not fetch, mutate source objects or treat a digest as source authentication', () => {
  const v = fixture();
  v.lighthouseResult.runWarnings = ['source warning'];
  const before = structuredClone(v);
  const projected = output(v);
  assert.deepEqual(v, before);
  assert.equal(projected.sourceWarningsPresent, true);
  assert.equal(projected.sourceVerified, false);
  assert.equal('providerCredentials' in projected, false);
  assert.equal('fetchUrl' in projected, false);
  assert.equal('email' in projected, false);
});
