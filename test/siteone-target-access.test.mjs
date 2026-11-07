import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEvidence } from '../scripts/normalize.mjs';

// Synthetic fixtures: a root challenge is a source-access failure, not a
// low-quality page or a successful crawl. No live target is fetched in tests.
const siteone = {
  crawler: { version: '2.5.1' },
  qualityScores: {
    overall: { score: 9.7 },
    categories: [{ code: 'seo', name: 'SEO', score: 9.4, label: 'Excellent' }],
  },
  summary: { items: [{ aplCode: '404', status: 'OK', text: 'No broken pages found' }] },
};
const lighthouse = {
  lighthouseVersion: '13.4.1',
  audits: { 'document-title': { title: 'Has a document title', score: 1 } },
  categories: { seo: { title: 'SEO', score: 1 } },
};
const root = 'https://example.test/';
const row = (url, status, type = 1) => ({ url, status, type });
const normalize = (results) => normalizeEvidence({
  siteId: 'example-site',
  target: 'https://example.test',
  siteone: results === undefined ? siteone : { ...siteone, results },
  lighthouse,
});

test('refuses an excellent SiteOne score when the actual homepage was a 403 challenge', () => {
  assert.throws(
    () => normalize([
      row(root, '403'),
      row('https://example.test/cdn-cgi/challenge-platform/mock-script', '200', 2),
    ]),
    /SiteOne could not inspect target root: HTTP 403; refusing to normalize quality scores/,
  );
});

test('fails closed on inaccessible root statuses without treating secondary 200 as recovery', () => {
  for (const status of ['401', '404', '429', '500', '503', 403]) {
    assert.throws(
      () => normalize([row(root, status), row('https://example.test/asset.js', '200', 2)]),
      /SiteOne could not inspect target root: HTTP/,
      String(status),
    );
  }
});

test('preserves ordinary SiteOne evidence when the root is accessible but an asset fails', () => {
  const result = normalize([
    row(root, '200'),
    row('https://example.test/missing-resource.js', '403', 2),
  ]);
  assert.equal(result.sources.siteone.overallScore, 9.7);
  assert.equal(result.sources.siteone.observations[0].sourceStatus, 'OK');
  assert.equal(result.schemaMinorVersion, 3);
});

test('does not confuse unrelated or differently scoped URLs with the exact target root', () => {
  const result = normalize([
    row('https://other.example.test/', '403'),
    row('https://example.test/page', '403'),
    row(root, '200'),
  ]);
  assert.equal(result.sources.siteone.overallScore, 9.7);
});

test('preserves historical SiteOne fixtures with no results array', () => {
  assert.equal(normalize().sources.siteone.overallScore, 9.7);
});
