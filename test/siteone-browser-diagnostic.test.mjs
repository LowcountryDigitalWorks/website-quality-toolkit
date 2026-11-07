import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ROOT_URL, INPUT_LIMIT, parseScanExitCode, parseSiteoneRaw,
  summarizeDiagnostic, readBoundedJson,
} from '../scripts/siteone-browser-diagnostic.mjs';

const STAMP = '2026-11-07T07:41:23.000Z';
const version = '2.5.1.20260627';
const root = (status) => ({ url: ROOT_URL, status });
const challenge = { url: ROOT_URL + 'cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=synthetic', status: '200' };
const raw = (results) => ({ crawler: { version }, results });

test('exact homepage 403 with challenge resource is blocked, not a quality score', () => {
  assert.deepEqual(parseSiteoneRaw(raw([root('403'), challenge])), {
    rootHttpStatus: 403, challengeResourceObserved: true, coverage: 'blocked_or_http_error',
  });
});
test('exact homepage 200 is still content unverified, never accepted automatically', () => {
  const s = summarizeDiagnostic(raw([root('200')]), 0, STAMP);
  assert.equal(s.rootHttpStatus, 200);
  assert.equal(s.pageContentVerified, false);
  assert.equal(s.coverage, 'http_200_content_unverified');
  assert.equal(s.evidenceOnly, true);
});
test('homepage 200 with challenge resource is not treated as homepage verified', () => {
  const s = summarizeDiagnostic(raw([root(200), challenge]), 0, STAMP);
  assert.equal(s.coverage, 'http_200_challenge_resource_seen');
  assert.equal(s.pageContentVerified, false);
});
test('asset status does not substitute for missing homepage response', () => {
  assert.deepEqual(parseSiteoneRaw(raw([{ url: ROOT_URL + 'image.png', status: '200' }])), {
    rootHttpStatus: null, challengeResourceObserved: false, coverage: 'unknown',
  });
});
test('duplicated homepage, malformed record sets, and wrong pinned version refuse', () => {
  assert.throws(() => parseSiteoneRaw(raw([root('200'), root('200')])), /untrusted/);
  assert.throws(() => parseSiteoneRaw({ crawler: { version }, results: {} }), /untrusted/);
  assert.throws(() => parseSiteoneRaw({ crawler: { version: '2.6.0' }, results: [root('200')] }), /untrusted/);
});
test('unrecognized root status remains unknown', () => {
  const s = parseSiteoneRaw(raw([root('success')]));
  assert.equal(s.rootHttpStatus, null);
  assert.equal(s.coverage, 'unknown');
});
test('failed scanner with no raw output is explicitly unknown', () => {
  const s = summarizeDiagnostic(null, 13, STAMP);
  assert.equal(s.rootHttpStatus, null);
  assert.equal(s.coverage, 'unknown');
  assert.equal(s.scannerExitCode, 13);
});
test('no untrusted command, headers, body, cookie, contact, or IP is emitted', () => {
  const secret = 'secret@example.test';
  const input = raw([{
    ...root('200'), headers: { cookie: secret }, html: secret,
    extras: [{ diagnostic: '192.0.2.15' }],
  }]);
  input.crawler.command = '--http-auth=' + secret;
  input.options = { aiApiKey: secret };
  const output = JSON.stringify(summarizeDiagnostic(input, 0, STAMP));
  for (const forbidden of [secret, '192.0.2.15', 'http-auth', 'cookie', 'html', 'aiApiKey'])
    assert.equal(output.includes(forbidden), false, forbidden);
});
test('bounded scan exit and timestamp validation fails closed', () => {
  assert.equal(parseScanExitCode(0), 0);
  assert.equal(parseScanExitCode('255'), 255);
  for (const value of [-1, 256, '0x01', '1a', Infinity, null])
    assert.throws(() => parseScanExitCode(value), /untrusted/);
  for (const value of ['2026-02-29T07:41:23.000Z', '2026-11-07T07:41:23Z', '2026-11-07T07:41:23.000+00:00'])
    assert.throws(() => summarizeDiagnostic(null, 0, value), /untrusted/);
});
test('single bounded read rejects oversized and invalid UTF-8 files without leaking bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-browser-synthetic-'));
  try {
    const valid = path.join(dir, 'valid.json');
    fs.writeFileSync(valid, JSON.stringify(raw([root('403')])));
    assert.equal(readBoundedJson(valid).results[0].status, '403');
    const huge = path.join(dir, 'oversize.json');
    fs.writeFileSync(huge, Buffer.alloc(INPUT_LIMIT + 1, 65));
    assert.throws(() => readBoundedJson(huge), /untrusted/);
    const invalid = path.join(dir, 'invalid.json');
    fs.writeFileSync(invalid, Buffer.from([0xc3, 0x28]));
    assert.throws(() => readBoundedJson(invalid), /untrusted/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('manual workflow has no automatic trigger or arbitrary site input, and preserves browser isolation', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/siteone-browser-diagnostic.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|inputs):/m);
  assert.match(workflow, /--url=https:\/\/lowcountrydigitalworks\.com\//);
  for (const required of ['--single-page', '--browser', '--browser-workers=1', '--workers=1', '--max-reqs-per-sec=1'])
    assert.equal(workflow.includes(required), true, required);
  for (const forbidden of ['--browser-no-sandbox', '--browser-auto-download', '--ignore-robots-txt', '--user-agent=', '--proxy='])
    assert.equal(workflow.includes(forbidden), false, forbidden);
  assert.match(workflow, /retention-days: 7/);
  assert.match(workflow, /siteone-browser-sanitized\.json/);
  assert.doesNotMatch(workflow, /path:\s*.*siteone\.json/);
});

test('method string describes requested flags, not a measured sandbox guarantee', () => {
  const result = summarizeDiagnostic(raw([root('200')]), 0, STAMP);
  assert.equal(result.collectionMethod, 'single_page_chromium_no_sandbox_override_requested');
  assert.equal(result.pageContentVerified, false);
});

test('manual SiteOne help preflight accepts only documented exit 2, nonempty output and required flags', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/siteone-browser-diagnostic.yml', import.meta.url), 'utf8');
  assert.match(workflow, /help_status=0/);
  assert.match(workflow, /help="\$\(tools\/bin\/siteone-crawler --help 2>&1\)" \|\| help_status=\$\?/);
  assert.match(workflow, /if \[\[ "\$help_status" -ne 2 \|\| -z "\$help" \]\]; then/);
  assert.doesNotMatch(workflow, /--help 2>&1\)" \|\| true/);
  assert.match(workflow, /grep -Fq -- "\$option" <<< "\$help"/);
  assert.match(workflow, /Pinned SiteOne does not advertise required option/);
});

test('SiteOne --help preflight actually runs fail-closed with documented exit 2', { skip: process.platform === 'win32' }, () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/siteone-browser-diagnostic.yml', import.meta.url), 'utf8');
  const start = workflow.indexOf('          help_status=0\n');
  const end = workflow.indexOf("          printf 'WQT_DIAGNOSTIC_CHROME=", start);
  assert.ok(start >= 0 && end > start, 'locate exact help preflight in workflow');
  const preflight = 'set -euo pipefail\n' + workflow.slice(start, end);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-siteone-help-'));
  const bin = path.join(dir, 'tools', 'bin');
  const allFlags = '--single-page --browser --browser-path --browser-workers --workers --max-reqs-per-sec --timeout --browser-timeout --output-json-file';
  try {
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'siteone-crawler'),
      '#!/usr/bin/env bash\nprintf "%s" "$MOCK_HELP"\nexit "$MOCK_EXIT"\n',
      { mode: 0o755 });
    const run = (code, help) => spawnSync('bash', ['-c', preflight], {
      cwd: dir, encoding: 'utf8',
      env: { ...process.env, MOCK_EXIT: String(code), MOCK_HELP: help },
    });
    assert.equal(run(2, allFlags).status, 0, 'documented help exit 2 and all flags pass');
    assert.notEqual(run(0, allFlags).status, 0, 'silent status-0 behavior drift fails closed');
    assert.notEqual(run(1, allFlags).status, 0, 'unexpected help error fails closed');
    assert.notEqual(run(2, '').status, 0, 'empty help fails closed');
    assert.notEqual(run(2, '--browser --single-page').status, 0, 'missing required options fail closed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
