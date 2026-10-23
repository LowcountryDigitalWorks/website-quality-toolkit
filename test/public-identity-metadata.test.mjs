import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveTarget, TargetResolutionError } from '../scripts/resolve-target.mjs';

const resolverScript = fileURLToPath(new URL('../scripts/resolve-target.sh', import.meta.url));
const externalWorkflowPath = fileURLToPath(new URL('../.github/workflows/external-links.yml', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/targets/${name}`, import.meta.url));
const externalWorkflow = fs.readFileSync(externalWorkflowPath, 'utf8');

function runResolverCli(siteIdentifier) {
  return spawnSync('bash', [resolverScript, siteIdentifier], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
}

test('external-link artifact identity is run-bound and never includes raw site input', () => {
  assert.match(
    externalWorkflow,
    /^\s{10}name:\s+wqt-external-links-\$\{\{ github\.run_id \}\}\s*$/m,
  );
  assert.doesNotMatch(
    externalWorkflow,
    /name:\s+wqt-external-links-\$\{\{ inputs\.site \}\}/,
  );
});

test('public resolver CLI rejects hostile or unknown site identifiers without echoing them', () => {
  for (const siteIdentifier of [
    'https://customer.example/path?token=do-not-log',
    'future-customer-site',
  ]) {
    const result = runResolverCli(siteIdentifier);
    assert.equal(result.status, 2, `expected ${JSON.stringify(siteIdentifier)} to be rejected`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Unauthorized site identifier.\n');
    assert.ok(!result.stderr.includes(siteIdentifier));
  }
});

test('direct target resolution uses bounded caller-input rejection messages', () => {
  const unknown = 'future-customer-site';
  assert.throws(
    () => resolveTarget(unknown, fixture('valid.json')),
    (error) => error instanceof TargetResolutionError
      && error.message === 'Unauthorized site identifier.'
      && !error.message.includes(unknown),
  );

  const disabled = 'example-retired';
  assert.throws(
    () => resolveTarget(disabled, fixture('disabled.json')),
    (error) => error instanceof TargetResolutionError
      && error.message === 'Site identifier is disabled in the target registry.'
      && !error.message.includes(disabled),
  );
});
