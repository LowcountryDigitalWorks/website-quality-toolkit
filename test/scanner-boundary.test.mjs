import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scannerCorePath = fileURLToPath(new URL('../scripts/scanner-core.sh', import.meta.url));
const siteoneWrapperPath = fileURLToPath(new URL('../scripts/run-siteone.sh', import.meta.url));
const lighthouseWrapperPath = fileURLToPath(new URL('../scripts/run-lighthouse.sh', import.meta.url));

const scannerCore = fs.readFileSync(scannerCorePath, 'utf8');
const siteoneWrapper = fs.readFileSync(siteoneWrapperPath, 'utf8');
const lighthouseWrapper = fs.readFileSync(lighthouseWrapperPath, 'utf8');

test('scanner core refuses direct execution', () => {
  const result = spawnSync('bash', [scannerCorePath], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /library-only/);
});

test('public scanner wrappers retain fixed public authority resolution', () => {
  for (const wrapper of [siteoneWrapper, lighthouseWrapper]) {
    assert.match(wrapper, /WQT_SITE_ID/);
    assert.match(wrapper, /scripts\/resolve-target\.sh/);
    assert.doesNotMatch(wrapper, /resolve-private-target/);
    assert.doesNotMatch(wrapper, /WQT_TARGET_REGISTRY/);
  }
});

test('both public wrappers source the same shared scanner core', () => {
  assert.ok(siteoneWrapper.includes('source "${ROOT_DIR}/scripts/scanner-core.sh"'));
  assert.ok(lighthouseWrapper.includes('source "${ROOT_DIR}/scripts/scanner-core.sh"'));
  assert.ok(siteoneWrapper.includes('wqt_run_siteone "$TARGET" "$OUTPUT"'));
  assert.ok(lighthouseWrapper.includes('wqt_run_lighthouse "$TARGET" "$OUTPUT"'));
});

test('scanner command flags live only in the shared implementation', () => {
  const siteoneFlags = [
    '--output=json',
    '--output-html-report=',
    '--output-text-file=',
    '--http-cache-dir=',
    '--workers=2',
    '--max-reqs-per-sec=5',
    '--hide-progress-bar',
    '--no-color',
  ];
  for (const flag of siteoneFlags) {
    assert.ok(scannerCore.includes(flag), 'scanner core missing SiteOne flag: ' + flag);
    assert.ok(!siteoneWrapper.includes(flag), 'SiteOne wrapper must not duplicate ' + flag);
  }

  const lighthouseFlags = [
    '--preset=desktop',
    '--only-categories=performance,accessibility,best-practices,seo',
    '--output=json',
    '--quiet',
    '--chrome-flags=',
  ];
  for (const flag of lighthouseFlags) {
    assert.ok(scannerCore.includes(flag), 'scanner core missing Lighthouse flag: ' + flag);
    assert.ok(!lighthouseWrapper.includes(flag), 'Lighthouse wrapper must not duplicate ' + flag);
  }
});

test('scanner core does not resolve target authority itself', () => {
  assert.doesNotMatch(scannerCore, /resolve-target/);
  assert.doesNotMatch(scannerCore, /resolve-private-target/);
  assert.doesNotMatch(scannerCore, /config\/targets\.json/);
  assert.doesNotMatch(scannerCore, /WQT_SITE_ID/);
});
