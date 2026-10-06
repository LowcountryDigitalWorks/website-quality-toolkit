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

function bashPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  return filePath
    .replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`)
    .replaceAll('\\', '/');
}

const bashScannerCorePath = bashPath(scannerCorePath);
test('scanner core refuses direct executable invocation before any scanner can run', () => {
  const result = spawnSync('bash', [bashScannerCorePath], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      SITEONE_BIN: '/definitely-not-a-siteone-binary',
      CHROME_PATH: '/definitely-not-a-chrome-binary',
    },
  });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'scanner-core.sh is library-only; resolve an authorized target before sourcing it.\n',
  );
  assert.doesNotMatch(result.stderr, /SiteOne|Lighthouse/);
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

test('scanner-native report paths are deterministic siblings of raw evidence', () => {
  const result = spawnSync('bash', ['-lc', `source '${bashScannerCorePath}' && wqt_report_dir_for_output '/tmp/wqt/site-001/raw/siteone.json'`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, '/tmp/wqt/site-001/reports\n');
  assert.match(scannerCore, /siteone_report="\$\{report_dir\}\/siteone\.html"/);
  assert.match(scannerCore, /lighthouse_report="\$\{report_dir\}\/lighthouse\.html"/);
});

test('SiteOne emits JSON and source-native HTML from one bounded scanner invocation', () => {
  const siteoneFlags = [
    '--output=json',
    '--output-json-file="$output"',
    '--output-html-report="$siteone_report"',
    "--output-text-file=''",
    "--http-cache-dir=''",
    '--workers=2',
    '--max-reqs-per-sec=5',
    '--hide-progress-bar',
    '--no-color',
  ];
  for (const flag of siteoneFlags) {
    assert.ok(scannerCore.includes(flag), 'scanner core missing SiteOne flag: ' + flag);
    assert.ok(!siteoneWrapper.includes(flag), 'SiteOne wrapper must not duplicate ' + flag);
  }
  assert.equal((scannerCore.match(/^\s*"\$binary" \\$/gm) ?? []).length, 1, 'SiteOne must execute once');
  assert.doesNotMatch(scannerCore, /--upload(?:=|\s)/);
  assert.doesNotMatch(scannerCore, /--mail-(?:to|from|smtp)/);
  assert.doesNotMatch(scannerCore, /--ai-[A-Za-z0-9-]+/);
});

test('Lighthouse emits JSON and HTML in one browser execution without a presentation-only second load', () => {
  const lighthouseFlags = [
    '--preset=desktop',
    '--only-categories=performance,accessibility,best-practices,seo',
    '--output=json',
    '--output=html',
    '--output-path="$report_base"',
    '--quiet',
    '--chrome-flags=',
  ];
  for (const flag of lighthouseFlags) {
    assert.ok(scannerCore.includes(flag), 'scanner core missing Lighthouse flag: ' + flag);
    assert.ok(!lighthouseWrapper.includes(flag), 'Lighthouse wrapper must not duplicate ' + flag);
  }
  assert.equal(
    (scannerCore.match(/CHROME_PATH="\$chrome_path" "\$lighthouse_bin" "\$target" \\/g) ?? []).length,
    1,
    'Lighthouse must execute once',
  );
  assert.doesNotMatch(scannerCore, /--view(?:=|\s)/);
});

test('scanner-native HTML remains presentation-only and raw JSON retains canonical input paths', () => {
  assert.match(scannerCore, /mv "\$generated_json" "\$output"/);
  assert.match(scannerCore, /mv "\$generated_html" "\$lighthouse_report"/);
  assert.match(scannerCore, /test -s "\$output"/);
  assert.match(scannerCore, /test -s "\$siteone_report"/);
  assert.match(scannerCore, /test -s "\$lighthouse_report"/);
});

test('scanner core does not resolve target authority itself', () => {
  assert.doesNotMatch(scannerCore, /resolve-target/);
  assert.doesNotMatch(scannerCore, /resolve-private-target/);
  assert.doesNotMatch(scannerCore, /config\/targets\.json/);
  assert.doesNotMatch(scannerCore, /WQT_SITE_ID/);
});
