import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeEvidence, validateFacts } from '../scripts/normalize.mjs';
import { renderSummary } from '../scripts/write-summary.mjs';

const siteone = JSON.parse(fs.readFileSync(new URL('./fixtures/siteone.json', import.meta.url), 'utf8'));
const lighthouse = JSON.parse(fs.readFileSync(new URL('./fixtures/lighthouse.json', import.meta.url), 'utf8'));
const siteoneFacts = JSON.parse(fs.readFileSync(new URL('./fixtures/siteone-facts.json', import.meta.url), 'utf8'));
const historicalMinor1 = JSON.parse(fs.readFileSync(new URL('./fixtures/normalized-v1-minor1.json', import.meta.url), 'utf8'));

const clone = (value) => structuredClone(value);

function normalize(siteoneInput = siteoneFacts, messageTarget = 'https://example.test') {
  return normalizeEvidence({
    siteId: 'example-site',
    target: messageTarget,
    siteone: siteoneInput,
    lighthouse,
  });
}

function siteOneObservation(result, code) {
  return result.sources.siteone.observations.find((item) => item.code === code);
}

function factValue(result, code, id) {
  const observation = siteOneObservation(result, code);
  return observation?.facts?.find((fact) => fact.id === id)?.value;
}

function assertNoForbiddenRawKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenRawKeys(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    assert.ok(!['results', 'tables', 'options'].includes(key), `normalized output must not expose raw key ${key}`);
    assertNoForbiddenRawKeys(value[key]);
  }
}

test('normalizes evidence without creating LDW quality thresholds', () => {
  const result = normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse });
  assert.equal(result.schemaVersion, 'ldw.website-quality.v1');
  assert.equal(result.schemaMinorVersion, 2);
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

test('preserves the exact historical minor1 fixture while current output advances only the artifact minor for unrelated findings', () => {
  const current = normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse });
  const historicalShape = clone(current);
  historicalShape.schemaMinorVersion = 1;
  assert.deepEqual(historicalShape, historicalMinor1);
  assert.equal(historicalMinor1.schemaMinorVersion, 1);
  assert.equal(current.schemaMinorVersion, 2);
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

test('derives affected-resource-count from structured SiteOne 2.5.1 cache evidence', () => {
  const result = normalize();
  const observation = siteOneObservation(result, 'static-assets-short-cache');
  assert.equal(observation.sourceStatus, 'NOTICE');
  assert.deepEqual(observation.facts, [{ id: 'affected-resource-count', valueType: 'number', value: 11, unit: 'count' }]);
});

test('keeps NOTICE status stable while structured cache count changes from 11 to 1', () => {
  const eleven = normalize();
  const oneInput = clone(siteoneFacts);
  oneInput.results = [oneInput.results[0], ...oneInput.results.slice(11)];
  const one = normalize(oneInput);
  assert.equal(siteOneObservation(eleven, 'static-assets-short-cache').sourceStatus, 'NOTICE');
  assert.equal(siteOneObservation(one, 'static-assets-short-cache').sourceStatus, 'NOTICE');
  assert.equal(factValue(eleven, 'static-assets-short-cache', 'affected-resource-count'), 11);
  assert.equal(factValue(one, 'static-assets-short-cache', 'affected-resource-count'), 1);
});

test('emits observed zero for cache and redirect counts', () => {
  const input = clone(siteoneFacts);
  input.results = input.results.slice(11);
  input.tables.redirects.rows = [];
  const result = normalize(input);
  assert.equal(factValue(result, 'static-assets-short-cache', 'affected-resource-count'), 0);
  assert.equal(factValue(result, 'redirects', 'redirect-count'), 0);
});

test('derives redirect-count only from structured redirect rows', () => {
  const result = normalize();
  assert.deepEqual(siteOneObservation(result, 'redirects').facts, [
    { id: 'redirect-count', valueType: 'number', value: 1, unit: 'count' },
  ]);
});

test('message wording changes do not change typed facts', () => {
  const first = normalize();
  const secondInput = clone(siteoneFacts);
  secondInput.summary.items[0].text = 'completely different cache wording claiming 999';
  secondInput.summary.items[1].text = 'completely different redirect wording claiming zero';
  const second = normalize(secondInput);
  assert.deepEqual(siteOneObservation(first, 'static-assets-short-cache').facts, siteOneObservation(second, 'static-assets-short-cache').facts);
  assert.deepEqual(siteOneObservation(first, 'redirects').facts, siteOneObservation(second, 'redirects').facts);
});

test('matching approved findings fail closed when required structured data is missing or malformed, without prose fallback', () => {
  const missingResults = clone(siteoneFacts);
  delete missingResults.results;
  missingResults.summary.items[0].text = '999 short-cache assets according to prose';
  assert.throws(() => normalize(missingResults), /requires SiteOne results/);

  const malformedCache = clone(siteoneFacts);
  malformedCache.results[0].cacheTypeFlags = -1;
  assert.throws(() => normalize(malformedCache), /cacheTypeFlags must be a non-negative safe integer/);

  const missingRedirectRows = clone(siteoneFacts);
  delete missingRedirectRows.tables.redirects.rows;
  missingRedirectRows.summary.items[1].text = '42 redirect(s) found';
  assert.throws(() => normalize(missingRedirectRows), /requires SiteOne tables\.redirects\.rows/);

  const malformedRedirect = clone(siteoneFacts);
  malformedRedirect.tables.redirects.rows[0].statusCode = '300';
  assert.throws(() => normalize(malformedRedirect), /301 through 308/);
});

test('static-assets-short-cache fails closed for malformed SiteOne results row structure', () => {
  const cases = [
    {
      name: 'non-object row',
      mutate(input) { input.results[0] = 'not-an-object'; },
      pattern: /result\[0\] must be a JSON object/,
    },
    {
      name: 'missing URL',
      mutate(input) { delete input.results[0].url; },
      pattern: /result\[0\]\.url must be a string/,
    },
    {
      name: 'non-string URL',
      mutate(input) { input.results[0].url = 42; },
      pattern: /result\[0\]\.url must be a string/,
    },
    {
      name: 'invalid absolute URL',
      mutate(input) { input.results[0].url = 'not an absolute url'; },
      pattern: /parseable absolute URL/,
    },
    {
      name: 'missing status',
      mutate(input) { delete input.results[0].status; },
      pattern: /result\[0\]\.status must be a string/,
    },
    {
      name: 'non-string status',
      mutate(input) { input.results[0].status = 200; },
      pattern: /result\[0\]\.status must be a string/,
    },
    {
      name: 'missing type',
      mutate(input) { delete input.results[0].type; },
      pattern: /result\[0\]\.type must be a non-negative safe integer/,
    },
    {
      name: 'string type',
      mutate(input) { input.results[0].type = '2'; },
      pattern: /result\[0\]\.type must be a non-negative safe integer/,
    },
    {
      name: 'unsupported SiteOne type',
      mutate(input) { input.results[0].type = 13; },
      pattern: /supported SiteOne 2\.5\.1 content-type ID/,
    },
  ];

  for (const scenario of cases) {
    const input = clone(siteoneFacts);
    scenario.mutate(input);
    assert.throws(
      () => normalize(input),
      scenario.pattern,
      `expected malformed case "${scenario.name}" to fail closed`,
    );
  }
});

test('valid non-qualifying SiteOne results remain ordinary cache-fact filters', () => {
  const input = clone(siteoneFacts);
  input.results = [
    { url: 'https://example.test/not-200.js', status: '304', type: 2, cacheTypeFlags: 0, cacheLifetime: 0 },
    { url: 'https://cdn.example.net/external.js', status: '200', type: 2, cacheTypeFlags: 0, cacheLifetime: 0 },
    { url: 'https://example.test/index.html', status: '200', type: 1, cacheTypeFlags: 0, cacheLifetime: 0 },
    { url: 'https://example.test/data.json', status: '200', type: 8, cacheTypeFlags: 0, cacheLifetime: 0 },
    { url: 'https://example.test/redirect', status: '200', type: 9, cacheTypeFlags: 0, cacheLifetime: 0 },
    { url: 'https://example.test/other.bin', status: '200', type: 10, cacheTypeFlags: 0, cacheLifetime: 0 },
    { url: 'https://example.test/feed.xml', status: '200', type: 12, cacheTypeFlags: 0, cacheLifetime: 0 },
  ];

  const result = normalize(input);
  assert.equal(factValue(result, 'static-assets-short-cache', 'affected-resource-count'), 0);
});

test('unrelated SiteOne observations omit facts', () => {
  const result = normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse });
  for (const observation of result.sources.siteone.observations) {
    assert.ok(!Object.prototype.hasOwnProperty.call(observation, 'facts'));
  }
});

test('Lighthouse normalized observations remain structurally unchanged and never gain facts', () => {
  const current = normalizeEvidence({ siteId: 'example-site', target: 'https://example.test', siteone, lighthouse });
  assert.deepEqual(current.sources.lighthouse, historicalMinor1.sources.lighthouse);
  assert.deepEqual(
    current.observations.filter((item) => item.source === 'lighthouse'),
    historicalMinor1.observations.filter((item) => item.source === 'lighthouse'),
  );
  for (const observation of current.sources.lighthouse.observations) {
    assert.ok(!Object.prototype.hasOwnProperty.call(observation, 'facts'));
  }
});

test('normalized evidence never exposes raw SiteOne results, tables, or options', () => {
  assertNoForbiddenRawKeys(normalize());
});

test('generic fact validation preserves numeric zero as distinct from explicit unknown null', () => {
  const facts = validateFacts([
    { id: 'observed-zero', valueType: 'number', value: 0 },
    { id: 'unknown-number', valueType: 'number', value: null },
  ]);
  assert.equal(facts[0].value, 0);
  assert.equal(facts[1].value, null);
  assert.notDeepEqual(facts[0], facts[1]);
});

test('generic fact validation rejects duplicates, overflow count, invalid ids, units, keys, text, types, and numbers', () => {
  assert.throws(() => validateFacts([
    { id: 'duplicate', valueType: 'boolean', value: true },
    { id: 'duplicate', valueType: 'boolean', value: false },
  ]), /duplicate fact id/);

  assert.throws(() => validateFacts(Array.from({ length: 9 }, (_, index) => ({
    id: `fact-${index}`,
    valueType: 'number',
    value: index,
  }))), /no more than 8/);

  assert.throws(() => validateFacts([{ id: 'Invalid_ID', valueType: 'number', value: 1 }]), /\.id must match/);
  assert.throws(() => validateFacts([{ id: 'valid', valueType: 'number', value: 1, unit: 'a'.repeat(33) }]), /\.unit must match/);
  assert.throws(() => validateFacts([{ id: 'valid', valueType: 'number', value: 1, extra: true }]), /unexpected key/);
  assert.throws(() => validateFacts([{ id: 'valid', valueType: 'text', value: 'x'.repeat(257) }]), /at most 256/);
  assert.throws(() => validateFacts([{ id: 'valid', valueType: 'boolean', value: 'true' }]), /must be a boolean/);
  assert.throws(() => validateFacts([{ id: 'valid', valueType: 'number', value: Infinity }]), /finite number/);
  assert.throws(() => validateFacts([{ id: 'valid', valueType: 'number', value: Number.MAX_SAFE_INTEGER + 1 }]), /finite number/);
  assert.throws(() => validateFacts([{ id: 'affected-resource-count', valueType: 'number', value: -1, unit: 'count' }]), /non-negative safe integer/);
  assert.throws(() => validateFacts([{ id: 'redirect-count', valueType: 'number', value: 1 }]), /unit "count"/);
});

test('facts sort deterministically by locale-independent ASCII id ordering', () => {
  const facts = validateFacts([
    { id: 'z-last', valueType: 'boolean', value: true },
    { id: 'a-first', valueType: 'boolean', value: true },
    { id: 'a-0', valueType: 'boolean', value: true },
  ]);
  assert.deepEqual(facts.map((fact) => fact.id), ['a-0', 'a-first', 'z-last']);
});
