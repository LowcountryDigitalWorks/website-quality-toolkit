import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeEvidence } from '../scripts/normalize.mjs';

// Synthetic-only regression for the public normalizer's already-accepted
// primary-root fail-closed behavior. No HTTP request, browser, scan or private
// site target is involved; the fixture domain is reserved for documentation.
const fixtureSiteOne = JSON.parse(readFileSync(
  new URL('./fixtures/siteone.json', import.meta.url), 'utf8',
));
const fixtureLighthouse = JSON.parse(readFileSync(
  new URL('./fixtures/lighthouse.json', import.meta.url), 'utf8',
));

const TARGET = 'https://example.test';
const ROOT = TARGET + '/';

function normalizeWithResults(results) {
  const siteone = structuredClone(fixtureSiteOne);
  if (results !== undefined) siteone.results = structuredClone(results);
  return normalizeEvidence({
    siteId: 'example-site',
    target: TARGET,
    siteone,
    lighthouse: structuredClone(fixtureLighthouse),
  });
}

const expected = normalizeWithResults(undefined);

function rejectsRootStatus(status, url = ROOT, additional = []) {
  assert.throws(
    () => normalizeWithResults([{ url, status }, ...additional]),
    (error) => error instanceof Error
      && error.message.includes('SiteOne could not inspect target root: HTTP ' + Number(status))
      && error.message.includes('refusing to normalize quality scores'),
    'Explicit target root ' + url + ' with status ' + status + ' must not yield scored site evidence',
  );
}

test('valid historical fixture with no results array remains normalized source evidence', () => {
  const output = normalizeWithResults(undefined);
  assert.deepEqual(output, expected);
  assert.equal(output.schemaVersion, 'ldw.website-quality.v1');
  assert.equal(output.schemaMinorVersion, 3);
  assert.equal(output.evidenceOnly, true);
  assert.equal(output.gatePolicy.qualityThresholdsApplied, false);
  assert.equal(output.gatePolicy.siteOneCiModeEnabled, false);
});

for (const status of [403, 404, 429, 500, 503]) {
  test('numeric root HTTP ' + status + ' fails closed, including origin spelling without slash', () => {
    rejectsRootStatus(status, ROOT);
    rejectsRootStatus(status, TARGET);
  });
}

test('HTTP root error strings fail closed without inferring success from other pages', () => {
  rejectsRootStatus('403', ROOT, [
    { url: TARGET + '/services/', status: 200 },
    { url: TARGET + '/robots.txt', status: 200 },
  ]);
  rejectsRootStatus('503', TARGET, [
    { url: TARGET + '/healthy-child', status: 200 },
  ]);
});

test('root HTTP 200 with a failing child does not reclassify the root as blocked', () => {
  const output = normalizeWithResults([
    { url: ROOT, status: 200 },
    { url: TARGET + '/broken', status: 403 },
  ]);
  assert.deepEqual(output, expected);
  assert.equal(output.sources.siteone.overallScore, expected.sources.siteone.overallScore);
});

test('unrelated host root HTTP 403 is not treated as the trusted target root', () => {
  assert.deepEqual(normalizeWithResults([
    { url: 'https://another.example.test/', status: 403 },
    { url: ROOT, status: '200' },
  ]), expected);
});

test('inaccessible subpage or asset is not a primary-root failure', () => {
  const output = normalizeWithResults([
    { url: TARGET + '/services/', status: 403 },
    { url: TARGET + '/asset.css', status: 503 },
    { url: ROOT, status: 200 },
  ]);
  assert.deepEqual(output, expected);
});

test('root error detection is independent of raw result ordering', () => {
  const blocked = { url: ROOT, status: '429' };
  const other = { url: TARGET + '/healthy', status: 200 };
  rejectsRootStatus('429', ROOT, [other]);
  assert.throws(
    () => normalizeWithResults([other, blocked]),
    /SiteOne could not inspect target root: HTTP 429/,
  );
});

test('an explicit root HTTP 200 is source input, not a new LDW health verdict', () => {
  const output = normalizeWithResults([{ url: ROOT, status: 200 }]);
  assert.deepEqual(output, expected);
  assert.equal(output.sources.siteone.observations.length, expected.sources.siteone.observations.length);
});
