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
  assert.match(output, /- Source statuses: OK: 1, UNKNOWN: 2/);
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
    /- Category scores \(0-100\): Performance: 92, accessibility: 93, Best Practices: 0, SEO: 100, PWA: n\/a, Custom: n\/a/,
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
  assert.match(output, /- Overall source score: n\/a /);
  assert.match(output, /- Source statuses: none/);
  assert.match(output, /- Category scores \(0-100\): none/);
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
    /- Skipped URL context: 17 external-host URL\(s\) intentionally skipped by the same-host crawl policy; no internal or other skipped URLs/,
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


test('minor 4 renders provider-neutral compression delivery context without applying a threshold', () => {
  const data = structuredClone(baseValidData);
  data.schemaMinorVersion = 4;
  data.sources.compression = {
    tool: 'LDW Compression Probe',
    version: '1',
    requestedAcceptEncoding: 'zstd, br, gzip',
    observations: [{
      source: 'compression',
      code: 'delivery-encoding',
      facts: [
        { id: 'brotli-response-count', valueType: 'number', value: 2, unit: 'count' },
        { id: 'compressible-sample-count', valueType: 'number', value: 10, unit: 'count' },
        { id: 'compression-sample-count', valueType: 'number', value: 12, unit: 'count' },
        { id: 'gzip-response-count', valueType: 'number', value: 1, unit: 'count' },
        { id: 'non-200-response-count', valueType: 'number', value: 1, unit: 'count' },
        { id: 'unencoded-response-count', valueType: 'number', value: 1, unit: 'count' },
        { id: 'unknown-encoding-response-count', valueType: 'number', value: 1, unit: 'count' },
        { id: 'zstd-response-count', valueType: 'number', value: 5, unit: 'count' },
      ],
    }],
  };

  const output = renderSummary(data);
  assert.match(output, /## Compression Delivery/);
  assert.match(output, /Requested Accept-Encoding: `zstd, br, gzip`/);
  assert.match(output, /10 compressible candidate\(s\) across 12 same-origin sample\(s\)/);
  assert.match(output, /zstd 5; br 2; gzip 1; none 1; unknown 1; non-200 1/);
  assert.match(output, /No compression threshold or provider-specific policy is applied/);
});

test('older schema minors ignore the additive compression source', () => {
  const data = structuredClone(baseValidData);
  data.schemaMinorVersion = 3;
  data.sources.compression = {
    requestedAcceptEncoding: 'zstd, br, gzip',
    observations: [{
      source: 'compression',
      code: 'delivery-encoding',
      facts: [
        { id: 'brotli-response-count', valueType: 'number', value: 0, unit: 'count' },
        { id: 'compressible-sample-count', valueType: 'number', value: 1, unit: 'count' },
        { id: 'compression-sample-count', valueType: 'number', value: 1, unit: 'count' },
        { id: 'gzip-response-count', valueType: 'number', value: 0, unit: 'count' },
        { id: 'non-200-response-count', valueType: 'number', value: 0, unit: 'count' },
        { id: 'unencoded-response-count', valueType: 'number', value: 0, unit: 'count' },
        { id: 'unknown-encoding-response-count', valueType: 'number', value: 0, unit: 'count' },
        { id: 'zstd-response-count', valueType: 'number', value: 1, unit: 'count' },
      ],
    }],
  };

  const output = renderSummary(data);
  assert.doesNotMatch(output, /## Compression Delivery/);
  assert.doesNotMatch(output, /Requested Accept-Encoding/);
});
