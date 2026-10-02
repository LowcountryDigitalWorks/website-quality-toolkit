import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadRegistry, resolveTarget, SITE_ID_PATTERN, TargetResolutionError } from '../scripts/resolve-target.mjs';

const resolverScript = fileURLToPath(new URL('../scripts/resolve-target.sh', import.meta.url));
const privateResolverScript = fileURLToPath(new URL('../scripts/resolve-private-target.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/targets/${name}`, import.meta.url));

const PRIVATE_RESOLUTION_FAILURE = 'Private target resolution failed.\n';

// The production CLI never accepts a caller-controlled registry path (no
// env var, no flag). It always resolves against the checked-in
// config/targets.json, matching the exact production invocation contract.
function runResolverCli(siteIdentifier) {
  return spawnSync('bash', [resolverScript, siteIdentifier], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
}

function runPrivateResolverCli(registryPath, siteIdentifier, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [privateResolverScript, registryPath, siteIdentifier, ...extraArgs],
    {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
    },
  );
}

function assertPrivateResolverFailure(result, forbiddenValues = []) {
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, PRIVATE_RESOLUTION_FAILURE);
  for (const value of forbiddenValues) {
    assert.ok(
      !result.stderr.includes(value),
      `private resolver stderr must not disclose ${JSON.stringify(value)}`,
    );
  }
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

test('trusted private resolver accepts a valid synthetic private registry and enabled opaque ID', () => {
  const result = runPrivateResolverCli(fixture('valid.json'), 'example-one');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://example-one.test\n');
  assert.equal(result.stderr, '');
});

test('trusted private resolver requires exactly registry path plus opaque site ID', () => {
  const cases = [
    spawnSync(process.execPath, [privateResolverScript], { encoding: 'utf8' }),
    spawnSync(process.execPath, [privateResolverScript, fixture('valid.json')], { encoding: 'utf8' }),
    runPrivateResolverCli(fixture('valid.json'), 'example-one', ['extra']),
  ];
  for (const result of cases) {
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:/);
  }
});

test('trusted private resolver rejects direct URLs without disclosing the supplied value', () => {
  const siteIdentifier = 'https://example-one.test';
  const result = runPrivateResolverCli(fixture('valid.json'), siteIdentifier);
  assertPrivateResolverFailure(result, [siteIdentifier, 'Unauthorized site identifier']);
});

test('trusted private resolver reuses the full fail-closed registry contract with generic CLI failures', () => {
  const cases = [
    [fixture('disabled.json'), 'example-retired'],
    [fixture('duplicate-id.json'), 'example-one'],
    [fixture('duplicate-origin.json'), 'example-one'],
    [fixture('malformed-json.json'), 'example-one'],
    [fixture('malformed-schema.json'), 'example-one'],
    [fixture('unsafe.json'), 'example-insecure'],
    [fixture('unexpected-root-field.json'), 'example-one'],
    [fixture('unexpected-site-field.json'), 'example-one'],
    [fixture('invalid-environment.json'), 'example-one'],
    [fixture('does-not-exist.json'), 'example-one'],
    [fixture('valid.json'), 'not-registered'],
  ];

  for (const [registryPath, siteIdentifier] of cases) {
    const result = runPrivateResolverCli(registryPath, siteIdentifier);
    assertPrivateResolverFailure(result);
  }
});

test('trusted private resolver failures do not disclose private runtime details', () => {
  const unknownSiteId = 'private-unregistered-site';
  const validRegistryPath = fixture('valid.json');
  assertPrivateResolverFailure(
    runPrivateResolverCli(validRegistryPath, unknownSiteId),
    [
      validRegistryPath,
      unknownSiteId,
      'Unauthorized site identifier',
    ],
  );

  const duplicateOriginPath = fixture('duplicate-origin.json');
  assertPrivateResolverFailure(
    runPrivateResolverCli(duplicateOriginPath, 'example-one'),
    [
      duplicateOriginPath,
      'example-one',
      'https://example-shared.test',
      'duplicate canonical origin',
    ],
  );

  const unexpectedMetadataPath = fixture('unexpected-site-field.json');
  assertPrivateResolverFailure(
    runPrivateResolverCli(unexpectedMetadataPath, 'example-one'),
    [
      unexpectedMetadataPath,
      'example-one',
      'apiKey',
      'this-must-never-be-silently-accepted',
      'unexpected field',
    ],
  );

  const missingRegistryPath = fixture('private-registry-does-not-exist.json');
  assertPrivateResolverFailure(
    runPrivateResolverCli(missingRegistryPath, 'example-one'),
    [
      missingRegistryPath,
      'example-one',
      'Target registry not found',
    ],
  );
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
