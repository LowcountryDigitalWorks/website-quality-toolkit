import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_SUMMARY_INPUT_BYTES, readBoundedSummaryInput, renderSummary } from '../scripts/write-summary.mjs';

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
  assert.ok(output.includes('- Source statuses: OK: 1, UNKNOWN: 2, SOMETHING\\_UNRECOGNIZED: 1'));
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
  assert.ok(output.includes("Lighthouse source `fetchTime`: 2026-10-05T12:00:00\\.000Z"));
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

test('SiteOne source text is bounded and cannot create Markdown HTML, links or images', () => {
  const data = structuredClone(baseValidData);
  const tick = String.fromCharCode(96);
  data.sources.siteone.version = '<ScRiPt>alert(1)</ScRiPt>';
  data.sources.siteone.executedAt = '<svg/onload=alert(1)>';
  data.sources.siteone.overallScore = '<img src=x onerror=alert(1)>';
  data.sources.siteone.categoryScores = [{
    code: 'category',
    name: '<IMG src=x>',
    label: '[click](https://attacker.example.test) ![pixel](https://attacker.example.test)',
    score: '<iframe src=x>',
  }];
  data.sources.siteone.observations = [{
    sourceStatus: 'WARNING',
    code: 'code' + tick + '[link](https://attacker.example.test)',
    message: '<ScRiPt>alert(1)</ScRiPt> ![pixel](https://attacker.example.test) **bold** | cell\n# heading',
    facts: [{ id: 'source-text', valueType: 'text', value: '<IMG src=x onerror=1>' }],
  }];
  const output = renderSummary(data);
  assert.doesNotMatch(output, /<(script|img|svg|iframe)\b/i);
  assert.ok(output.includes('&lt;ScRiPt&gt;alert(1)&lt;/ScRiPt&gt;'));
  assert.ok(output.includes('`&lt;ScRiPt&gt;alert(1)&lt;/ScRiPt&gt; !\\[pixel\\](https://attacker.example.test)'));
  assert.ok(output.includes('`\\[click\\](https://attacker.example.test) !\\[pixel\\](https://attacker.example.test)`'));
  assert.ok(output.includes('&lt;IMG src=x onerror=1&gt;'));
  assert.ok(output.includes(tick.repeat(2) + ' code' + tick + '[link](https://attacker.example.test) ' + tick.repeat(2)));
  assert.doesNotMatch(output, /(^|\n)# heading/m);
});

test('ordinary source text remains readable while very long messages are capped', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.observations = [{
    code: 'long-source',
    sourceStatus: 'WARNING',
    message: 'A'.repeat(4000),
  }];
  const output = renderSummary(data);
  assert.ok(output.includes('A'.repeat(160) + '…'));
  assert.ok(!output.includes('A'.repeat(161)));
  assert.match(output, /- Source statuses: WARNING: 1/);
});

test('excess SiteOne source category rows are truthfully omitted without changing normalized evidence', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.categoryScores = Array.from({ length: 30 }, (_, index) => ({
    code: 'category-' + String(index).padStart(2, '0'),
    name: 'Category ' + String(index).padStart(2, '0'),
    score: index,
  }));
  const output = renderSummary(data);
  assert.match(output, /14 additional source categories omitted by the 16-row presentation bound/);
  assert.match(output, /Category 00: 0/);
  assert.match(output, /Category 15: 15/);
  assert.doesNotMatch(output, /Category 16: 16/);
});

test('unrecognized SiteOne source status groups are capped and counted without a health verdict', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.observations = Array.from({ length: 28 }, (_, index) => ({
    code: 'source-' + index,
    sourceStatus: 'STATUS_' + String(index).padStart(2, '0'),
    message: 'Provider status ' + index,
  }));
  const output = renderSummary(data);
  const statusLine = output.split('\n').find((line) => line.startsWith('- Source statuses:'));
  assert.ok(statusLine);
  assert.match(statusLine, /4 additional source status group\(s\) omitted by the 24-group presentation bound/);
  assert.doesNotMatch(statusLine, /STATUS\\_27/);
  assert.match(output, /8 additional non-OK source observation\(s\) omitted by the 20-item presentation bound/);
  assert.doesNotMatch(output, /LDW health: healthy/i);
});

test('source-originated extreme output volume fails closed rather than returning unbounded Markdown', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.observations = Array.from({ length: 20 }, (_, index) => ({
    code: 'source-' + index,
    sourceStatus: 'WARNING',
    message: 'source item',
    facts: Array.from({ length: 40 }, (_, subIndex) => ({
      id: 'fact-' + subIndex,
      valueType: 'text',
      value: 'A'.repeat(200),
    })),
  }));
  assert.throws(() => renderSummary(data), /operator summary exceeds the bounded Markdown output size/);
});


test('provider bare URLs, www addresses and emails render as inert GFM code spans', () => {
  const data = structuredClone(baseValidData);
  data.sources.siteone.executedAt = 'http://attacker.example.org/snapshot';
  data.sources.siteone.categoryScores = [{
    code: 'seo', name: 'See www.attacker.example.org', score: 7,
    label: 'https://attacker.example.org/report',
  }];
  data.sources.siteone.observations = [{
    code: 'untrusted-url', sourceStatus: 'WARNING',
    message: 'Open https://attacker.example.org/phish to resolve',
    facts: [{ id: 'contact', valueType: 'text', value: 'help@attacker.example.org' }],
  }];
  data.sources.lighthouse.observations = [{
    code: 'source-advice', title: 'Contact help@attacker.example.org for support',
    scoreDisplayMode: 'informative', score: null,
    displayValue: 'https://attacker.example.org/details',
  }];
  const output = renderSummary(data);
  assert.ok(output.includes('— `Open https://attacker.example.org/phish to resolve`'));
  assert.ok(output.includes('contact=`help@attacker.example.org`'));
  assert.ok(output.includes('`See www.attacker.example.org`: 7 (`https://attacker.example.org/report`)'));
  assert.ok(output.includes('— `Contact help@attacker.example.org for support`;'));
  assert.ok(output.includes('source display: `https://attacker.example.org/details`'));
  assert.ok(output.includes('SiteOne source `executedAt`: `http://attacker.example.org/snapshot`'));
  assert.doesNotMatch(output, /— Open https?:\/\//);
  assert.doesNotMatch(output, /contact=help@attacker/);
});

test('provider collection input caps fail early and leave normal source rows unchanged', () => {
  const cases = [
    ['siteone', 'observations', 4_097],
    ['lighthouse', 'observations', 4_097],
    ['siteone', 'categoryScores', 513],
    ['lighthouse', 'categoryScores', 513],
  ];
  for (const [source, key, count] of cases) {
    const data = structuredClone(baseValidData);
    data.sources[source][key] = Array.from({ length: count }, () => ({ sourceStatus: 'OK' }));
    assert.throws(() => renderSummary(data), /bounded source input collections/);
  }
  const facts = structuredClone(baseValidData);
  facts.sources.siteone.observations = [{
    code: 'overlarge-facts', sourceStatus: 'WARNING',
    facts: Array.from({ length: 129 }, (_, i) => ({ id: 'fact-' + i, valueType: 'number', value: 1 })),
  }];
  assert.throws(() => renderSummary(facts), /bounded source input facts/);
  assert.match(renderSummary(baseValidData), /Source statuses: WARNING: 1, OK: 1/);
});

test('provider URL backslashes are not left unescaped inside inert code spans', () => {
  const data = structuredClone(baseValidData);
  const slash = String.fromCharCode(92);
  data.sources.siteone.observations = [{
    code: 'backslash-url', sourceStatus: 'WARNING',
    message: 'Read https://attacker.example.org/path' + slash + 'extra',
  }];
  const output = renderSummary(data);
  assert.ok(output.includes('https://attacker.example.org/path' + slash + slash + 'extra`'));
  assert.match(output, /Source statuses: WARNING: 1/);
});


test('offline summary pre-parse input is descriptor-bounded and keeps valid legacy rendering', (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-summary-safe-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const valid = path.join(folder, 'valid.json');
  const legacy = JSON.stringify(baseValidData);
  fs.writeFileSync(valid, legacy, 'utf8');
  assert.deepEqual(readBoundedSummaryInput(valid), baseValidData);
  assert.equal(renderSummary(readBoundedSummaryInput(valid)), renderSummary(baseValidData));

  // Accept precisely the fixed byte ceiling without silently truncating data.
  const exact = path.join(folder, 'exact-limit.json');
  fs.writeFileSync(exact, legacy + ' '.repeat(MAX_SUMMARY_INPUT_BYTES - Buffer.byteLength(legacy)));
  assert.deepEqual(readBoundedSummaryInput(exact), baseValidData);

  const over = path.join(folder, 'over-limit.json');
  fs.writeFileSync(over, Buffer.alloc(MAX_SUMMARY_INPUT_BYTES + 1, 0x20));
  assert.throws(() => readBoundedSummaryInput(over), /valid bounded local JSON input file/);

  const malformed = path.join(folder, 'malformed.json');
  fs.writeFileSync(malformed, Buffer.from([0x7b, 0xc3, 0x28, 0x7d]));
  assert.throws(() => readBoundedSummaryInput(malformed), /valid bounded local JSON input file/);
  const invalidJson = path.join(folder, 'invalid.json');
  fs.writeFileSync(invalidJson, '{invalid:', 'utf8');
  assert.throws(() => readBoundedSummaryInput(invalidJson), /valid bounded local JSON input file/);
  assert.throws(() => readBoundedSummaryInput(folder), /valid bounded local JSON input file/);
  assert.throws(() => readBoundedSummaryInput(path.join(folder, 'not-found.json')),
    /valid bounded local JSON input file/);
  assert.throws(() => readBoundedSummaryInput(''), /valid bounded local JSON input file/);
});
