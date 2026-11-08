import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAX_RAW_BYTES, classifySiteOneAccess, readRawIfPresent, renderAccessNotice,
} from '../scripts/siteone-access-summary.mjs';
import { normalizeEvidence } from '../scripts/normalize.mjs';

const origin = 'https://example.test';
const root = { url: origin + '/', status: '200' };
const challenged = { url: origin + '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1', status: '200' };
const raw = (results) => ({ crawler: { version: '2.5.1' }, results,
  qualityScores: { overall: { score: 10 } },
  summary: { items: [{ aplCode: '404', status: 'OK', text: 'excellent score despite blocked root' }] },
});
const classify = (results) => classifySiteOneAccess(raw(results), origin);

test('explicit blocked exact homepage statuses stay blocked despite excellent SiteOne score', () => {
  for (const status of ['403', 404, '429', '500', '503']) {
    const result = classify([{ ...root, status }, challenged]);
    assert.deepEqual(result, {
      coverage: 'blocked_root_http_error',
      rootHttpStatus: Number(status),
      challengeResourceObserved: true,
    });
  }
});

test('literal origin without slash is accepted, but query, fragment, other scheme/host and asset do not substitute', () => {
  assert.equal(classify([{ url: origin, status: 403 }]).rootHttpStatus, 403);
  for (const url of [
    origin + '/asset.js', origin + '/?q=1', origin + '/#top',
    'http://example.test/', 'https://elsewhere.example.test/', 'https://example.test:8443/',
    'https://user:pass@example.test/',
  ]) assert.equal(classify([{ url, status: 403 }]).coverage, 'unknown', url);
});

test('200 root never becomes content-verified even when no challenge resource was observed', () => {
  assert.deepEqual(classify([root]), {
    coverage: 'http_200_content_unverified', rootHttpStatus: 200, challengeResourceObserved: false,
  });
  assert.deepEqual(classify([root, challenged]), {
    coverage: 'http_200_challenge_resource_seen_content_unverified',
    rootHttpStatus: 200, challengeResourceObserved: true,
  });
});

test('blocked child or secondary 200 cannot change root access semantics', () => {
  const other = { url: origin + '/asset.js', status: 403 };
  assert.equal(classify([root, other]).coverage, 'http_200_content_unverified');
  assert.equal(classify([other, challenged]).coverage, 'unknown');
  assert.equal(classify([{ ...root, status: 403 }, other]).coverage, 'blocked_root_http_error');
});

test('redirects, 204 and unavailable source are separate and not healthy', () => {
  assert.equal(classify([{ ...root, status: '301' }]).coverage, 'redirect_unverified');
  assert.equal(classify([{ ...root, status: 204 }]).coverage, 'other_success_content_unverified');
  assert.deepEqual(classifySiteOneAccess(null, origin), {
    coverage: 'raw_unavailable', rootHttpStatus: null, challengeResourceObserved: false,
  });
  assert.equal(classifySiteOneAccess(raw(undefined), origin).coverage, 'unknown');
});

test('duplicate or malformed root status is unknown, never invents a passing site', () => {
  assert.equal(classify([root, { url: origin, status: '403' }]).coverage, 'unknown');
  for (const status of [undefined, null, -1, 0, 600, 'success', '200 OK', '0200']) {
    assert.equal(classify([{ ...root, status }]).coverage, 'unknown');
  }
});

test('wrong scanner version, data shape or unbounded result count fail closed', () => {
  assert.throws(() => classifySiteOneAccess({ ...raw([root]), crawler: { version: '2.6.0' } }, origin));
  assert.throws(() => classifySiteOneAccess({ ...raw([root]), crawler: {} }, origin));
  assert.throws(() => classifySiteOneAccess([], origin));
  assert.throws(() => classifySiteOneAccess(raw(Array(50001).fill({ url: origin + '/x' })), origin));
});

test('access note emits fixed statuses only and never raw personal/secret payload or quality score', () => {
  const secret = 'person@example.test / private-token-REDACTED';
  const value = raw([{ ...root, status: 403, headers: { cookie: secret }, html: secret }, challenged]);
  value.crawler.command = secret;
  const result = classifySiteOneAccess(value, origin);
  const note = renderAccessNotice('lowcountrydigitalworks', result);
  assert.match(note, /blocked_root_http_error/);
  assert.match(note, /HTTP status: 403/);
  assert.match(note, /no actual homepage content verification/i);
  for (const banned of [secret, 'quality score: 10', 'cdn-cgi/challenge-platform/', 'person@example.test']) {
    assert.equal(note.includes(banned), false);
  }
  assert.throws(() => renderAccessNotice('https://example.test/', result));
  assert.throws(() => renderAccessNotice('id', { coverage: 'healthy', rootHttpStatus: 200, challengeResourceObserved: false }));
});

test('legacy normalizer still rejects a blocked site on same exact root while access note is diagnostic-only', () => {
  const siteone = raw([{ ...root, status: 403 }, challenged]);
  const lighthouse = { lighthouseVersion: '13.4.1', audits: { 'document-title': { title: 'title' } } };
  assert.equal(classifySiteOneAccess(siteone, origin).coverage, 'blocked_root_http_error');
  assert.throws(() => normalizeEvidence({ siteId: 'example', target: origin, siteone, lighthouse }),
    /refusing to normalize quality scores/);
});

test('bounded source read handles missing, malformed, oversize and invalid UTF-8 without echoing source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-access-summary-'));
  try {
    const missing = path.join(dir, 'missing.json');
    assert.equal(readRawIfPresent(missing), null);
    const file = path.join(dir, 'raw.json');
    fs.writeFileSync(file, JSON.stringify(raw([root])));
    assert.equal(readRawIfPresent(file).results[0].status, '200');
    fs.writeFileSync(file, 'not a JSON object');
    assert.throws(() => readRawIfPresent(file));
    fs.writeFileSync(file, Buffer.from([0xc3, 0x28]));
    assert.throws(() => readRawIfPresent(file));
    fs.truncateSync(file, MAX_RAW_BYTES + 1);
    assert.throws(() => readRawIfPresent(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('descriptor reader rejects symlink substitution and directories without a second path lookup', (t) => {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || process.platform === 'win32') {
    t.skip('No-follow symlink proof requires a platform that supports O_NOFOLLOW');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-no-follow-'));
  try {
    const original = path.join(dir, 'siteone.json');
    const moved = path.join(dir, 'accepted-source.json');
    const link = path.join(dir, 'source-link.json');
    fs.writeFileSync(original, JSON.stringify(raw([root])));
    assert.equal(readRawIfPresent(original).results[0].status, '200');

    fs.symlinkSync(original, link);
    assert.throws(() => readRawIfPresent(link), 'symlink must not be followed to read source bytes');

    // A race-style replacement of a previously safe path by a symlink must
    // fail closed. A single O_NOFOLLOW open replaces exists/lstat/read-by-path.
    fs.renameSync(original, moved);
    fs.symlinkSync(moved, original);
    assert.throws(() => readRawIfPresent(original), 'replaced file path must not be followed');
    assert.equal(readRawIfPresent(moved).results[0].status, '200');

    assert.throws(() => readRawIfPresent(dir), 'directory is not a regular source file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI resolves only registered opaque site ID, preserves unknown for no raw file and never exposes raw secrets', () => {
  const script = fileURLToPath(new URL('../scripts/siteone-access-summary.mjs', import.meta.url));
  const missing = path.join(os.tmpdir(), 'wqt-access-intentionally-nonexistent-file-000.json');
  const ok = spawnSync(process.execPath, [script, 'lowcountrydigitalworks', missing], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /raw_unavailable/);
  const blocked = spawnSync(process.execPath, [script, 'https://example.test', missing], { encoding: 'utf8' });
  assert.equal(blocked.status, 0, 'operator-only diagnostic must not become a new scan gate');
  assert.match(blocked.stdout, /Coverage: unknown/);
  assert.doesNotMatch(blocked.stdout + blocked.stderr, /https:\/\/example.test/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-access-invalid-'));
  try {
    const invalid = path.join(dir, 'untrusted.json');
    fs.writeFileSync(invalid, '{bad-json: private@example.test }');
    const failure = spawnSync(process.execPath, [script, 'lowcountrydigitalworks', invalid], { encoding: 'utf8' });
    assert.equal(failure.status, 0, 'invalid operator note must not flip existing scan result');
    assert.match(failure.stdout, /Coverage: unknown/);
    assert.doesNotMatch(failure.stdout + failure.stderr, /private@example.test/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('existing public workflow remains manual target-scoped with read-only permissions, no extra provider requests', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/website-quality.yml', import.meta.url), 'utf8');
  assert.match(workflow, /scan:\s*\n\s*if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /^permissions:\s*\n\s*contents: read$/m);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.match(workflow, /run: node scripts\/siteone-access-summary\.mjs "\$WQT_SITE_ID" artifacts\/raw\/siteone\.json >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow, /if: \$\{\{ always\(\) && github\.event_name == 'workflow_dispatch' \}\}/);
  assert.equal((workflow.match(/run: bash scripts\/run-siteone\.sh artifacts\/raw\/siteone\.json/g) ?? []).length, 1);
  assert.equal((workflow.match(/run: bash scripts\/run-lighthouse\.sh artifacts\/raw\/lighthouse\.json/g) ?? []).length, 1);
});
