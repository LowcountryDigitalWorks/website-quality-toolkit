import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeEvidence } from '../scripts/normalize.mjs';
import { renderSummary } from '../scripts/write-summary.mjs';

const siteone = JSON.parse(fs.readFileSync(new URL('./fixtures/siteone.json', import.meta.url), 'utf8'));
const lighthouse = JSON.parse(fs.readFileSync(new URL('./fixtures/lighthouse.json', import.meta.url), 'utf8'));

test('normalizes evidence without creating LDW quality thresholds', () => {
  const result = normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse });
  assert.equal(result.schemaVersion, 'ldw.website-quality.v1');
  assert.equal(result.schemaMinorVersion, 1);
  assert.equal(result.siteId, 'example-site');
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

test('rejects a missing, blank, or syntactically invalid siteId', () => {
  for (const siteId of [undefined, '', '  ', 'Example-Site', 'example.site', 'example_site', 'https://example.test', '-example']) {
    assert.throws(
      () => normalizeEvidence({ siteId, target: 'https://example.test', siteone, lighthouse }),
      /siteId must be a valid opaque site identifier/,
      `expected ${JSON.stringify(siteId)} to be rejected`,
    );
  }
});

test('summary labels scanner output as evidence, not a gate', () => {
  const result = normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse });
  const summary = renderSummary(result);
  assert.match(summary, /Site: `example-site`/);
  assert.match(summary, /Evidence only/);
  assert.match(summary, /SiteOne `--ci` mode is intentionally disabled/);
  assert.match(summary, /Performance: 92/);
  assert.match(summary, /SEO: 100/);
});

test('rejects malformed scanner evidence', () => {
  assert.throws(
    () => normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone: {}, lighthouse }),
    /crawler metadata/,
  );
  assert.throws(
    () => normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse: {} }),
    /lighthouseVersion/,
  );
});

test('normalizes scanner evidence with deterministic ordering', () => {
  const unorderedSiteone = {
    crawler: { version: '2.5.1' },
    qualityScores: {
      categories: [
        { code: 'seo', name: 'SEO', score: 9.5, label: 'Excellent' },
        { code: 'accessibility', name: 'Accessibility', score: 8.5, label: 'Good' },
      ],
    },
    summary: {
      items: [
        { aplCode: 'zzz', status: 'WARNING', text: 'last' },
        { aplCode: 'aaa', status: 'NOTICE', text: 'first' },
      ],
    },
  };
  const unorderedLighthouse = {
    lighthouseVersion: '13.4.1',
    categories: {
      seo: { title: 'SEO', score: 1 },
      performance: { title: 'Performance', score: 0.92 },
    },
    audits: {
      'z-audit': { title: 'Z' },
      'a-audit': { title: 'A' },
    },
  };

  const result = normalizeEvidence({
    siteId: 'example-site',
    target: 'https://example.test',
    siteone: unorderedSiteone,
    lighthouse: unorderedLighthouse,
  });

  assert.deepEqual(result.sources.siteone.categoryScores.map((item) => item.code), ['accessibility', 'seo']);
  assert.deepEqual(
    result.sources.siteone.observations.map((item) => `${item.sourceStatus}:${item.code}`),
    ['NOTICE:aaa', 'WARNING:zzz'],
  );
  assert.deepEqual(result.sources.lighthouse.categoryScores.map((item) => item.id), ['performance', 'seo']);
  assert.deepEqual(result.sources.lighthouse.observations.map((item) => item.code), ['a-audit', 'z-audit']);
});

test('preserves null fallbacks for sparse optional scanner fields', () => {
  const sparseSiteone = {
    crawler: { version: '2.5.1' },
    qualityScores: {
      categories: [{}],
      overall: {},
    },
    summary: {
      items: [{}],
    },
  };
  const sparseLighthouse = {
    lighthouseVersion: '13.4.1',
    categories: {
      seo: {},
    },
    audits: {
      'document-title': {},
    },
  };

  const result = normalizeEvidence({
    siteId: 'example-site',
    target: 'https://example.test',
    siteone: sparseSiteone,
    lighthouse: sparseLighthouse,
  });

  assert.deepEqual(result.sources.siteone.categoryScores, [{ code: null, name: null, score: null, label: null }]);
  assert.deepEqual(result.sources.siteone.observations, [
    { source: 'siteone', code: null, sourceStatus: null, message: null },
  ]);
  assert.equal(result.sources.siteone.command, null);
  assert.equal(result.sources.siteone.executedAt, null);
  assert.equal(result.sources.siteone.overallScore, null);
  assert.deepEqual(result.sources.lighthouse.categoryScores, [{ id: 'seo', title: null, score: null }]);
  assert.deepEqual(result.sources.lighthouse.observations, [{
    source: 'lighthouse',
    code: 'document-title',
    title: null,
    score: null,
    scoreDisplayMode: null,
    displayValue: null,
    numericValue: null,
    numericUnit: null,
  }]);
  assert.equal(result.sources.lighthouse.fetchTime, null);
  assert.equal(result.sources.lighthouse.requestedUrl, null);
  assert.equal(result.sources.lighthouse.finalUrl, null);
  assert.equal(result.sources.lighthouse.userAgent, null);
});
