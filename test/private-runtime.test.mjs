import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const privateResolver = fileURLToPath(new URL('../scripts/resolve-private-target.mjs', import.meta.url));
const publicResolver = fileURLToPath(new URL('../scripts/resolve-target.mjs', import.meta.url));
const scannerCore = fileURLToPath(new URL('../scripts/scanner-core.sh', import.meta.url));
const siteoneWrapper = fileURLToPath(new URL('../scripts/run-siteone.sh', import.meta.url));
const lighthouseWrapper = fileURLToPath(new URL('../scripts/run-lighthouse.sh', import.meta.url));
const publicRegistry = fileURLToPath(new URL('../config/targets.json', import.meta.url));
const fixture = (name) => fileURLToPath(new URL('./fixtures/targets/' + name, import.meta.url));

function runNode(script, args = [], env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
}

function runPrivate(registryName, siteId) {
  return runNode(privateResolver, [fixture(registryName), siteId]);
}

function assertPrivateFailure(result) {
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Private target resolution failed.\n');
}

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('private resolver resolves an enabled opaque ID through the existing registry implementation', () => {
  const result = runPrivate('valid.json', 'example-one');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://example-one.test\n');
  assert.equal(result.stderr, '');
});

test('private resolver requires exactly registry path plus opaque Site ID', () => {
  const cases = [
    [],
    [fixture('valid.json')],
    [fixture('valid.json'), 'example-one', 'unexpected-extra-argument'],
  ];
  for (const args of cases) {
    const result = runNode(privateResolver, args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(
      result.stderr,
      'Usage: node scripts/resolve-private-target.mjs <registry-path> <site-id>\n',
    );
  }
});

test('private resolver rejects URL-shaped and unknown Site IDs without echoing private input', () => {
  for (const id of ['https://example-one.test', 'not-registered']) {
    const result = runPrivate('valid.json', id);
    assertPrivateFailure(result);
    assert.ok(!result.stderr.includes(id));
  }
});

test('private resolver fails closed across malformed, disabled, duplicate, unsafe, and unexpected-field registries', () => {
  const cases = [
    ['disabled.json', 'example-retired'],
    ['duplicate-id.json', 'example-one'],
    ['duplicate-origin.json', 'example-one'],
    ['invalid-environment.json', 'example-one'],
    ['malformed-json.json', 'example-one'],
    ['malformed-schema.json', 'example-one'],
    ['unexpected-root-field.json', 'example-one'],
    ['unexpected-site-field.json', 'example-one'],
    ['unsafe.json', 'example-insecure'],
  ];
  for (const [registryName, siteId] of cases) {
    assertPrivateFailure(runPrivate(registryName, siteId));
  }

  const missing = runNode(privateResolver, [fixture('does-not-exist.json'), 'example-one']);
  assertPrivateFailure(missing);
});

test('private failure diagnostics do not disclose registry contents or unrelated entries', () => {
  const result = runPrivate('unexpected-site-field.json', 'example-one');
  assertPrivateFailure(result);
  assert.doesNotMatch(result.stderr, /apiKey|this-must-never-be-silently-accepted|example-one\.test/);
});

test('public resolver still cannot consume a caller-supplied registry path or environment override', () => {
  const result = runNode(
    publicResolver,
    ['lowcountrydigitalworks', fixture('valid.json')],
    { WQT_TARGET_REGISTRY: fixture('valid.json') },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://lowcountrydigitalworks.com\n');
  assert.equal(result.stderr, '');
});

test('public registry remains limited to the two accepted public targets', () => {
  const registry = JSON.parse(read(publicRegistry));
  assert.equal(registry.schemaVersion, 'ldw.wqt-target-registry.v1');
  assert.deepEqual(registry.sites.map((site) => site.id).sort(), [
    'donovanfamilydentistry',
    'lowcountrydigitalworks',
  ]);
});

test('scanner core is library-only and refuses direct execution', () => {
  const result = spawnSync('bash', [scannerCore], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /library-only module/);
});

test('both public wrappers preserve fixed target authority and use the same scanner core', () => {
  const siteone = read(siteoneWrapper);
  const lighthouse = read(lighthouseWrapper);

  for (const wrapper of [siteone, lighthouse]) {
    assert.ok(wrapper.includes('scripts/scanner-core.sh'));
    assert.ok(wrapper.includes('scripts/resolve-target.sh'));
    assert.ok(wrapper.includes('SITE_IDENTIFIER'));
    assert.ok(!wrapper.includes('WQT_TARGET_REGISTRY'));
  }

  assert.ok(siteone.includes('run_siteone_for_origin "$TARGET" "$OUTPUT"'));
  assert.ok(lighthouse.includes('run_lighthouse_for_origin "$TARGET" "$OUTPUT"'));
});

test('SiteOne and Lighthouse execution flags exist only in the shared scanner core', () => {
  const core = read(scannerCore);
  const siteone = read(siteoneWrapper);
  const lighthouse = read(lighthouseWrapper);

  for (const flag of [
    '--output-html-report=',
    '--http-cache-dir=',
    '--workers=2',
    '--max-reqs-per-sec=5',
  ]) {
    assert.ok(core.includes(flag), 'expected shared core to contain ' + flag);
    assert.ok(!siteone.includes(flag), 'SiteOne wrapper must not duplicate ' + flag);
  }

  for (const flag of [
    '--preset=desktop',
    '--only-categories=performance,accessibility,best-practices,seo',
    '--chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu"',
  ]) {
    assert.ok(core.includes(flag), 'expected shared core to contain ' + flag);
    assert.ok(!lighthouse.includes(flag), 'Lighthouse wrapper must not duplicate ' + flag);
  }

  const executableLines = core.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  assert.doesNotMatch(executableLines, /--ci(?:\s|$)/);
  assert.doesNotMatch(executableLines, /--browser(?:\s|$)/);
  assert.doesNotMatch(executableLines, /--ai-/);
  assert.doesNotMatch(executableLines, /--upload(?:\s|$)/);
});
