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
