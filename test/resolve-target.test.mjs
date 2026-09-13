import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRegistry, resolveTarget, SITE_ID_PATTERN, TargetResolutionError } from '../scripts/resolve-target.mjs';

const resolverScript = fileURLToPath(new URL('../scripts/resolve-target.sh', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/targets/${name}`, import.meta.url));

// The production CLI never accepts a caller-controlled registry path (no
// env var, no flag). It always resolves against the checked-in
// config/targets.json, matching the exact production invocation contract.
function runResolverCli(siteIdentifier) {
  return spawnSync('bash', [resolverScript, siteIdentifier], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
}

function writeTempRegistry(sites) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-targets-'));
  const file = path.join(dir, 'targets.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'ldw.wqt-target-registry.v1', sites }));
  return file;
}

test('lowcountrydigitalworks resolves only to the authorized LDW origin', () => {
  const result = runResolverCli('lowcountrydigitalworks');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://lowcountrydigitalworks.com\n');
  assert.equal(result.stderr, '');
});

test('donovanfamilydentistry resolves only to the authorized Donovan origin', () => {
  const result = runResolverCli('donovanfamilydentistry');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://donovanfamilydentistry.com\n');
  assert.equal(result.stderr, '');
});

test('the production CLI ignores any WQT_TARGET_REGISTRY environment override', () => {
  const otherRegistry = writeTempRegistry([
    { id: 'lowcountrydigitalworks', origin: 'https://attacker-controlled.test', environment: 'production', enabled: true },
  ]);
  const result = spawnSync('bash', [resolverScript, 'lowcountrydigitalworks'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', WQT_TARGET_REGISTRY: otherRegistry },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://lowcountrydigitalworks.com\n');
});

test('blank, malformed, URL-shaped, and unknown identifiers fail closed', () => {
  for (const identifier of ['', ' donovanfamilydentistry', 'https://example.com', 'future-site']) {
    const result = runResolverCli(identifier);
    assert.equal(result.status, 2, `expected ${JSON.stringify(identifier)} to be rejected`);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
});

test('registry-backed resolution matches the production config/targets.json entries', () => {
  const registry = loadRegistry();
  assert.equal(registry.schemaVersion, 'ldw.wqt-target-registry.v1');
  assert.deepEqual(registry.sites.map((entry) => entry.id).sort(), [
    'donovanfamilydentistry',
    'lowcountrydigitalworks',
  ]);
  for (const entry of registry.sites) {
    assert.equal(entry.enabled, true);
    assert.equal(entry.environment, 'production');
    assert.match(entry.origin, /^https:\/\//);
    assert.deepEqual(Object.keys(entry).sort(), ['enabled', 'environment', 'id', 'origin']);
  }
});

test('a disabled registry entry is rejected even though it is otherwise well-formed', () => {
  assert.throws(
    () => resolveTarget('example-retired', fixture('disabled.json')),
    /disabled in the target registry/,
  );
});

test('a duplicate id in the registry fails closed for every lookup against that registry', () => {
  assert.throws(() => resolveTarget('example-one', fixture('duplicate-id.json')), /duplicate id/);
});

test('a duplicate canonical origin in the registry fails closed even with distinct ids', () => {
  assert.throws(() => resolveTarget('example-one', fixture('duplicate-origin.json')), /duplicate canonical origin/);
});

test('malformed registry JSON fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('malformed-json.json')), /not valid JSON/);
});

test('a registry with the wrong schema version fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('malformed-schema.json')), /schemaVersion/);
});

test('an unsafe (non-HTTPS) registry entry fails closed', () => {
  assert.throws(() => resolveTarget('example-insecure', fixture('unsafe.json')), /unsafe or non-canonical origin/);
});

test('an unexpected root field in the registry fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('unexpected-root-field.json')), /unexpected field/);
});

test('an unexpected site-entry field in the registry fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('unexpected-site-field.json')), /unexpected field/);
});

test('an unauthorized "environment" value fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('invalid-environment.json')), /explicit, authorized "environment"/);
});

test('non-canonical origin alias forms are rejected even when the registry JSON is otherwise well-formed', () => {
  const aliasOrigins = [
    'https://example.test/',
    'https://example.test:443',
    'https://user:pass@example.test',
    'https://example.test/some-path',
    'https://example.test/?tracking=1',
    'https://example.test#fragment',
    'https://127.0.0.1',
    'https://localhost',
    'ftp://example.test',
  ];
  for (const origin of aliasOrigins) {
    const registryPath = writeTempRegistry([{ id: 'example-one', origin, environment: 'production', enabled: true }]);
    assert.throws(
      () => resolveTarget('example-one', registryPath),
      TargetResolutionError,
      `expected ${JSON.stringify(origin)} to be rejected as non-canonical`,
    );
  }
});

test('a missing registry file fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('does-not-exist.json')), /not found/);
});

test('an unknown site identifier fails closed against a valid registry', () => {
  assert.throws(() => resolveTarget('not-registered', fixture('valid.json')), /Unauthorized site identifier/);
});

test('resolveTarget still rejects blank and URL-shaped identifiers against a valid registry', () => {
  for (const identifier of ['', ' example-one', 'https://example.test']) {
    assert.throws(() => resolveTarget(identifier, fixture('valid.json')), TargetResolutionError);
  }
});

test('SITE_ID_PATTERN accepts only the accepted opaque-ID syntax', () => {
  for (const id of ['lowcountrydigitalworks', 'donovanfamilydentistry', 'a', '0-abc', 'a-1-b-2']) {
    assert.ok(SITE_ID_PATTERN.test(id), `expected ${JSON.stringify(id)} to match`);
  }
  for (const id of ['', 'Example', 'example.site', 'example_site', '-example', 'a'.repeat(65)]) {
    assert.ok(!SITE_ID_PATTERN.test(id), `expected ${JSON.stringify(id)} to be rejected`);
  }
});
