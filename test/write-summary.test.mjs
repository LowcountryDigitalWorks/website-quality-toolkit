import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSummary } from '../scripts/write-summary.mjs';

const baseValidData = {
  schemaVersion: 'ldw.website-quality.v1',
  schemaMinorVersion: 1,
  siteId: 'example-site',
  target: 'https://example.test',
  sources: {
    siteone: {
      version: '2.5.1',
      overallScore: 88,
      observations: [
        { sourceStatus: 'OK' },
        { sourceStatus: 'WARNING' },
      ],
    },
    lighthouse: {
      version: '13.4.1',
      categoryScores: [
        { id: 'performance', title: 'Performance', score: 0.92 },
        { id: 'seo', title: 'SEO', score: 1 },
      ],
    },
  },
};

test('rejects unsupported schemaVersion', () => {
  for (const invalidSchema of [undefined, null, '', 'ldw.website-quality.v2', 'v1']) {
    assert.throws(
      () => renderSummary({ ...baseValidData, schemaVersion: invalidSchema }),
      /Unsupported normalized evidence schema/,
    );
  }
  assert.throws(
    () => renderSummary(null),
    /Unsupported normalized evidence schema/,
  );
});

test('rejects missing siteone or lighthouse sources', () => {
  assert.throws(
    () => renderSummary({ ...baseValidData, sources: { lighthouse: {} } }),
    /Normalized evidence is missing sources/,
  );
  assert.throws(
    () => renderSummary({ ...baseValidData, sources: { siteone: {} } }),
    /Normalized evidence is missing sources/,
  );
  assert.throws(
    () => renderSummary({ ...baseValidData, sources: {} }),
    /Normalized evidence is missing sources/,
  );
  assert.throws(
    () => renderSummary({ ...baseValidData, sources: undefined }),
    /Normalized evidence is missing sources/,
  );
});

test('handles unknown and unrecognized SiteOne source statuses gracefully', () => {
  const data = {
    ...baseValidData,
    sources: {
      ...baseValidData.sources,
      siteone: {
        version: '2.5.1',
        observations: [
          { sourceStatus: 'OK' },
          { sourceStatus: 'SOMETHING_UNRECOGNIZED' },
          { sourceStatus: null },
          {},
        ],
      },
    },
  };

  const output = renderSummary(data);
  assert.match(output, /- Source statuses: OK: 1, UNKNOWN: 2, SOMETHING_UNRECOGNIZED: 1/);
});

test('renders Lighthouse numeric scores with percentage rounding and title/id fallback', () => {
  const data = {
    ...baseValidData,
    sources: {
      ...baseValidData.sources,
      lighthouse: {
        version: '13.4.1',
        categoryScores: [
          { id: 'perf', title: 'Performance', score: 0.923 },
          { id: 'accessibility', score: 0.927 },
          { id: 'best-practices', title: 'Best Practices', score: 0 },
          { id: 'seo', title: 'SEO', score: 1 },
          { id: 'pwa', title: 'PWA', score: null },
          { id: 'custom', title: 'Custom', score: 'not-a-number' },
        ],
      },
    },
  };

  const output = renderSummary(data);
  assert.match(
    output,
    /- Category scores \(\*\*SOURCE-NATIVE\*\* desktop lab evidence, 0-100\): accessibility: 93, Best Practices: 0, Custom: n\/a, Performance: 92, PWA: n\/a, SEO: 100/,
  );
});

test('preserves fallback behavior for optional version, score, and status values', () => {
  const data = {
    schemaVersion: 'ldw.website-quality.v1',
    target: 'https://example.test',
    sources: {
      siteone: {},
      lighthouse: {},
    },
  };

  const output = renderSummary(data);
  assert.match(output, /Site: `unknown`/);
  assert.match(output, /- Version: `unknown`/);
  assert.match(output, /- Overall source score \(\*\*SOURCE-NATIVE\*\*\): n\/a/);
  assert.match(output, /- Source statuses: none/);
  assert.match(output, /- Category scores \(\*\*SOURCE-NATIVE\*\* desktop lab evidence, 0-100\): none/);
});


test('preserves CRITICAL source status while explaining all-external intentional skip context', () => {
  const data = structuredClone(baseValidData);
  data.schemaMinorVersion = 3;
  data.sources.siteone.observations = [{
    code: 'skipped',
    sourceStatus: 'CRITICAL',
    facts: [
      { id: 'external-not-allowed-host-count', valueType: 'number', value: 17, unit: 'count' },
      { id: 'internal-skipped-url-count', valueType: 'number', value: 0, unit: 'count' },
      { id: 'other-skipped-url-count', valueType: 'number', value: 0, unit: 'count' },
      { id: 'skipped-url-count', valueType: 'number', value: 17, unit: 'count' },
    ],
  }];

  const output = renderSummary(data);
  assert.match(output, /- Source statuses: CRITICAL: 1/);
  assert.match(
    output,
    /- Skipped URL context: 17 external-host URL\(s\) intentionally skipped under current `site_only` same-authority crawl scope; no internal or other skipped URLs/,
  );
});

test('mixed skipped URL context remains explicit and is not summarized as all-intentional external skipping', () => {
  const data = structuredClone(baseValidData);
  data.schemaMinorVersion = 3;
  data.sources.siteone.observations = [{
    code: 'skipped',
    sourceStatus: 'CRITICAL',
    facts: [
      { id: 'external-not-allowed-host-count', valueType: 'number', value: 2, unit: 'count' },
      { id: 'internal-skipped-url-count', valueType: 'number', value: 1, unit: 'count' },
      { id: 'other-skipped-url-count', valueType: 'number', value: 1, unit: 'count' },
      { id: 'skipped-url-count', valueType: 'number', value: 4, unit: 'count' },
    ],
  }];

  const output = renderSummary(data);
  assert.match(output, /- Source statuses: CRITICAL: 1/);
  assert.match(output, /- Skipped URL context: 4 total; 2 external-host Not allowed host; 1 internal; 1 other/);
  assert.doesNotMatch(output, /no internal or other skipped URLs/);
});


test('older schema minors ignore minor-3 skipped URL facts', () => {
  const data = structuredClone(baseValidData);
  data.schemaMinorVersion = 2;
  data.sources.siteone.observations = [{
    code: 'skipped',
    sourceStatus: 'CRITICAL',
    facts: [
      { id: 'external-not-allowed-host-count', valueType: 'number', value: 17, unit: 'count' },
      { id: 'internal-skipped-url-count', valueType: 'number', value: 0, unit: 'count' },
      { id: 'other-skipped-url-count', valueType: 'number', value: 0, unit: 'count' },
      { id: 'skipped-url-count', valueType: 'number', value: 17, unit: 'count' },
    ],
  }];

  const output = renderSummary(data);
  assert.match(output, /- Source statuses: CRITICAL: 1/);
  assert.doesNotMatch(output, /- Skipped URL context:/);
});

test('operator summary exposes current scope, source-native labels, artifact guide, and downstream G.A.S. boundary', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.executedAt = '2026-10-05 12:00:00';
  data.sources.siteone.categoryScores = [
    { code: 'seo', name: 'SEO', score: 9.5, label: 'Excellent' },
    { code: 'security', name: 'Security', score: 8, label: 'Good' },
  ];
  data.sources.lighthouse.fetchTime = '2026-10-05T12:00:00.000Z';

  const output = renderSummary(data);
  assert.match(output, /Current profile: `site_only`/);
  assert.match(output, /whole-site same-authority crawl evidence/);
  assert.match(output, /focused homepage desktop lab evidence/);
  assert.match(output, /SiteOne `--ci` mode is intentionally disabled/);
  assert.match(output, /Overall source score \(\*\*SOURCE-NATIVE\*\*\): 88/);
  assert.match(output, /Category source scores \(\*\*SOURCE-NATIVE\*\*\): Security: 8 \(Good\), SEO: 9.5 \(Excellent\)/);
  assert.match(output, /SiteOne source `executedAt`: 2026-10-05 12:00:00/);
  assert.match(output, /Lighthouse source `fetchTime`: 2026-10-05T12:00:00.000Z/);
  assert.match(output, /`reports\/siteone\.html` — \*\*SOURCE-NATIVE SITEONE REPORT — NOT LDW QUALITY POLICY\*\*/);
  assert.match(output, /`reports\/lighthouse\.html` — \*\*SOURCE-NATIVE LIGHTHOUSE REPORT — NOT LDW QUALITY POLICY\*\*/);
  assert.match(output, /Broader longitudinal and cross-source Search \/ SEO \/ GEO-AIO \/ AI-visibility interpretation belongs downstream in G\.A\.S\./);
  assert.match(output, /WQT-SEM-003 \/ issue #16/);
  assert.match(output, /does not establish whether actual delivery used `zstd`, `br`, `gzip`, or none/);
});

test('operator summary is deterministic under equivalent input ordering', () => {
  const left = structuredClone(baseValidData);
  left.sources.siteone.categoryScores = [
    { code: 'seo', name: 'SEO', score: 9.5, label: 'Excellent' },
    { code: 'security', name: 'Security', score: 8, label: 'Good' },
  ];
  left.sources.siteone.observations = [
    { code: 'b', sourceStatus: 'WARNING', message: 'B' },
    { code: 'a', sourceStatus: 'CRITICAL', message: 'A' },
    { code: 'ok', sourceStatus: 'OK', message: 'OK' },
  ];
  left.sources.lighthouse.categoryScores = [
    { id: 'seo', title: 'SEO', score: 1 },
    { id: 'performance', title: 'Performance', score: 0.92 },
  ];

  const right = structuredClone(left);
  right.sources.siteone.categoryScores.reverse();
  right.sources.siteone.observations.reverse();
  right.sources.lighthouse.categoryScores.reverse();
  assert.equal(renderSummary(left), renderSummary(right));
});

test('non-OK SiteOne presentation is bounded and exposes omitted count', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.observations = Array.from({ length: 23 }, (_, index) => ({
    code: `finding-${String(index).padStart(2, '0')}`,
    sourceStatus: 'WARNING',
    message: `Source message ${index}`,
  }));
  const output = renderSummary(data);
  assert.equal((output.match(/\*\*WARNING\*\*/g) ?? []).length, 20);
  assert.match(output, /3 additional non-OK source observation\(s\) omitted by the 20-item presentation bound/);
  assert.doesNotMatch(output, /Source message 22/);
});

test('zero non-OK SiteOne findings are stated truthfully without manufacturing a health verdict', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.observations = [
    { code: 'ok-a', sourceStatus: 'OK', message: 'Source OK A' },
    { code: 'ok-b', sourceStatus: 'OK', message: 'Source OK B' },
  ];
  const output = renderSummary(data);
  assert.match(output, /No non-OK SiteOne summary observations are present in normalized evidence; this is not an LDW health verdict/);
  assert.doesNotMatch(output, /healthy/i);
});

test('non-OK source message and bounded typed facts remain visible', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.observations = [{
    code: 'redirects',
    sourceStatus: 'NOTICE',
    message: 'Source redirect evidence',
    facts: [
      { id: 'redirect-count', valueType: 'number', value: 3, unit: 'count' },
      { id: 'affected-resource-count', valueType: 'number', value: 7, unit: 'count' },
    ],
  }];
  const output = renderSummary(data);
  assert.match(output, /\*\*NOTICE\*\* `redirects` — Source redirect evidence/);
  assert.match(output, /facts: affected-resource-count=7 count, redirect-count=3 count/);
});