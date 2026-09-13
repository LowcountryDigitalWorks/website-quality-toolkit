import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRegistry, resolveTarget, TargetResolutionError } from '../scripts/resolve-target.mjs';

const resolverScript = fileURLToPath(new URL('../scripts/resolve-target.sh', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/targets/${name}`, import.meta.url));

function runResolverCli(siteIdentifier, registryPath) {
  return spawnSync('bash', [resolverScript, siteIdentifier], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      ...(registryPath ? { WQT_TARGET_REGISTRY: registryPath } : {}),
    },
  });
}

function writeTempRegistry(targets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-targets-'));
  const file = path.join(dir, 'targets.json');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 'ldw.website-quality-targets.v1', targets }));
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
  assert.equal(registry.schemaVersion, 'ldw.website-quality-targets.v1');
  assert.deepEqual(registry.targets.map((entry) => entry.id).sort(), [
    'donovanfamilydentistry',
    'lowcountrydigitalworks',
  ]);
  for (const entry of registry.targets) {
    assert.equal(entry.enabled, true);
    assert.match(entry.url, /^https:\/\//);
  }
});

test('a disabled registry entry is rejected even though it is otherwise well-formed', () => {
  assert.throws(
    () => resolveTarget('example-retired', fixture('disabled.json')),
    /disabled in the target registry/,
  );
  const result = runResolverCli('example-retired', fixture('disabled.json'));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /disabled in the target registry/);
});

test('a duplicate id in the registry fails closed for every lookup against that registry', () => {
  assert.throws(() => resolveTarget('example-one', fixture('duplicate.json')), /duplicate id/);
});

test('malformed registry JSON fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('malformed-json.json')), /not valid JSON/);
});

test('a registry with the wrong schema version fails closed', () => {
  assert.throws(() => resolveTarget('example-one', fixture('malformed-schema.json')), /schemaVersion/);
});

test('an unsafe (non-HTTPS) registry entry fails closed', () => {
  assert.throws(() => resolveTarget('example-insecure', fixture('unsafe.json')), /unsafe or malformed url/);
});

test('unsafe URL shapes are rejected even when the registry JSON is otherwise well-formed', () => {
  const unsafeUrls = [
    'https://user:pass@example.test',
    'https://example.test/some-path',
    'https://example.test/?tracking=1',
    'https://127.0.0.1',
    'https://localhost',
    'ftp://example.test',
  ];
  for (const url of unsafeUrls) {
    const registryPath = writeTempRegistry([{ id: 'example-one', url, enabled: true }]);
    assert.throws(
      () => resolveTarget('example-one', registryPath),
      TargetResolutionError,
      `expected ${JSON.stringify(url)} to be rejected as unsafe`,
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
