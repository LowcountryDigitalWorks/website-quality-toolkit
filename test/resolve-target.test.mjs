import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const resolver = fileURLToPath(new URL('../scripts/resolve-target.sh', import.meta.url));

function runResolver(siteIdentifier) {
  return spawnSync('bash', [resolver, siteIdentifier], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
}

test('lowcountrydigitalworks resolves only to the authorized LDW origin', () => {
  const result = runResolver('lowcountrydigitalworks');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://lowcountrydigitalworks.com\n');
  assert.equal(result.stderr, '');
});

test('donovanfamilydentistry resolves only to the authorized Donovan origin', () => {
  const result = runResolver('donovanfamilydentistry');
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'https://donovanfamilydentistry.com\n');
  assert.equal(result.stderr, '');
});

test('blank, malformed, URL-shaped, and unknown identifiers fail closed', () => {
  for (const identifier of ['', ' donovanfamilydentistry', 'https://example.com', 'future-site']) {
    const result = runResolver(identifier);
    assert.equal(result.status, 2, `expected ${JSON.stringify(identifier)} to be rejected`);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
});
