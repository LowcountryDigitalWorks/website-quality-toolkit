import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeEvidence } from '../scripts/normalize.mjs';
import { renderSummary } from '../scripts/write-summary.mjs';

const siteone = JSON.parse(fs.readFileSync(new URL('./fixtures/siteone.json', import.meta.url), 'utf8'));
const lighthouse = JSON.parse(fs.readFileSync(new URL('./fixtures/lighthouse.json', import.meta.url), 'utf8'));

test('normalizes evidence without creating LDW quality thresholds', () => {
  const result = normalizeEvidence({ target: 'https://example.test', siteone, lighthouse });
  assert.equal(result.schemaVersion, 'ldw.website-quality.v1');
  assert.equal(result.evidenceOnly, true);
  assert.deepEqual(result.gatePolicy, { qualityThresholdsApplied: false, siteOneCiModeEnabled: false });
  assert.equal(result.sources.siteone.version, '2.5.1');
  assert.equal(result.sources.lighthouse.version, '13.4.1');
  assert.deepEqual(result.sources.siteone.categoryScores.map((item) => item.code), ['security', 'seo']);
  assert.deepEqual(result.sources.lighthouse.categoryScores.map((item) => item.id), ['performance', 'seo']);
  assert.deepEqual(result.observations.map((item) => `${item.source}:${item.code}`), [
    'lighthouse:document-title',
    'lighthouse:first-contentful-paint',
    'siteone:404',
    'siteone:robots-txt-example.test'
  ]);
});

test('summary labels scanner output as evidence, not a gate', () => {
  const result = normalizeEvidence({ target: 'https://example.test', siteone, lighthouse });
  const summary = renderSummary(result);
  assert.match(summary, /Evidence only/);
  assert.match(summary, /SiteOne `--ci` mode is intentionally disabled/);
  assert.match(summary, /Performance: 92/);
  assert.match(summary, /SEO: 100/);
});

test('rejects malformed scanner evidence', () => {
  assert.throws(() => normalizeEvidence({ target: 'https://example.test', siteone: {}, lighthouse }), /crawler metadata/);
  assert.throws(() => normalizeEvidence({ target: 'https://example.test', siteone, lighthouse: {} }), /lighthouseVersion/);
});
