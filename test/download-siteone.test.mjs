import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('../scripts/download-siteone.sh', import.meta.url));
const script = fs.readFileSync(scriptPath, 'utf8');

test('official SiteOne fallback is pinned to the same exact release and integrity gate', () => {
  assert.match(script, /SITEONE_VERSION="2\.5\.1"/);
  assert.match(script, /ASSET_API_URL="https:\/\/api\.github\.com\/repos\/janreges\/siteone-crawler\/releases\/assets\/459279687"/);
  assert.match(script, /EXPECTED_SHA256="09278d958d4a087fa46093805cd33b085b96618001dd31d45c448ad724c9024e"/);
  assert.match(script, /EXPECTED_BYTES=10876162/);
  assert.match(script, /--header 'Accept: application\/octet-stream'/);
  assert.equal((script.match(/--proto-redir '=https'/g) ?? []).length, 2);
  assert.equal((script.match(/--max-filesize 20000000/g) ?? []).length, 2);
  assert.match(script, /curl --version/);
  assert.match(script, /10#\$curl_major < 8/);
  assert.doesNotMatch(script, /(?:secrets\.|GITHUB_TOKEN|Authorization:|curl .*https?:\/\/[^" ]*(?:sourceforge|cloudsmith))/i);
  const sizeGate = script.indexOf('stat -c');
  const hashGate = script.indexOf('sha256sum --check --strict');
  const unpack = script.indexOf('tar -xzf');
  const install = script.indexOf('install -m 0755');
  assert.ok(sizeGate > 0 && sizeGate < hashGate && hashGate < unpack && unpack < install);
  assert.ok(script.indexOf('if ! curl') < script.indexOf('ASSET_API_URL"', script.indexOf('if ! curl')));
});

test('synthetic blocked primary uses exact official API, but a wrong-digest asset cannot install', (t) => {
  if (process.platform === 'win32') {
    t.skip('Mock transport path uses POSIX shell utilities; hosted Linux is authoritative.');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-siteone-download-'));
  const binDir = path.join(dir, 'bin');
  const curlLog = path.join(dir, 'curl.log');
  const fakeCurl = path.join(binDir, 'curl');
  const destination = path.join(dir, 'out');

  const stub = `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'curl %s (synthetic)\\n' "$WQT_CURL_VERSION"
  exit 0
fi
printf '%s\\n' "$*" >> "$WQT_CURL_LOG"
out=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "--output" ]; then out="$arg"; fi
  previous="$arg"
done
case "$*" in
  *"/releases/download/v2.5.1/"*)
    if [ "$WQT_PRIMARY_OK" = "1" ]; then
      truncate -s "$WQT_FAKE_BYTES" "$out"
      exit 0
    fi
    exit 22
    ;;
  *"/releases/assets/459279687"*)
    truncate -s "$WQT_FAKE_BYTES" "$out"
    exit 0
    ;;
  *) exit 42 ;;
esac
`;

  try {
    fs.mkdirSync(binDir);
    fs.writeFileSync(fakeCurl, stub, { mode: 0o755 });
    const run = (primaryOk, version = '8.16.0', bytes = 10876162) => spawnSync('bash', [scriptPath, destination], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: binDir + path.delimiter + (process.env.PATH ?? ''),
        WQT_CURL_LOG: curlLog,
        WQT_PRIMARY_OK: primaryOk ? '1' : '0',
        WQT_CURL_VERSION: version,
        WQT_FAKE_BYTES: String(bytes),
      },
    });

    const fallback = run(false);
    assert.notEqual(fallback.status, 0, 'digest mismatch must fail closed');
    assert.match(fallback.stdout + fallback.stderr, /FAILED/);
    assert.equal(fs.existsSync(path.join(destination, 'siteone-crawler')), false);
    const attempts = fs.readFileSync(curlLog, 'utf8').trim().split('\n');
    assert.equal(attempts.length, 2, 'exactly one primary and one API call');
    // The URL is the final curl argument. Compare its COMPLETE value: a
    // substring match could accept a URL from a different publisher/host.
    assert.equal(
      attempts[0].trim().split(' ').at(-1),
      'https://github.com/janreges/siteone-crawler/releases/download/v2.5.1/siteone-crawler-v2.5.1-linux-x64.tar.gz',
    );
    assert.equal(
      attempts[1].trim().split(' ').at(-1),
      'https://api.github.com/repos/janreges/siteone-crawler/releases/assets/459279687',
    );
    assert.match(attempts[1], /Accept: application\/octet-stream/);

    fs.rmSync(curlLog);
    const rejectedPrimary = run(true);
    assert.notEqual(rejectedPrimary.status, 0, 'bad checksum must not silently try a different asset');
    assert.match(rejectedPrimary.stdout + rejectedPrimary.stderr, /FAILED/);
    const checksumAttempts = fs.readFileSync(curlLog, 'utf8').trim().split('\n');
    assert.equal(checksumAttempts.length, 1, 'primary transport success must not trigger fallback');
    assert.equal(fs.existsSync(path.join(destination, 'siteone-crawler')), false);

    // Model an HTTP response without Content-Length that exceeds the cap.
    // Even a dishonest/mock transport must never turn oversized bytes into an installed binary.
    fs.rmSync(curlLog);
    fs.rmSync(destination, { recursive: true, force: true });
    const oversize = run(false, '8.16.0', 21000000);
    assert.notEqual(oversize.status, 0, 'oversized stream must be rejected');
    assert.equal(fs.existsSync(path.join(destination, 'siteone-crawler')), false);
    const oversizeCalls = fs.readFileSync(curlLog, 'utf8').trim().split('\n');
    assert.equal(oversizeCalls.length, 2);

    // A curl that cannot guarantee a streamed byte limit must refuse before
    // any HTTP attempt or creation of the destination folder.
    fs.rmSync(curlLog);
    fs.rmSync(destination, { recursive: true, force: true });
    const outdatedCurl = run(false, '8.3.0', 21000000);
    assert.notEqual(outdatedCurl.status, 0);
    assert.match(outdatedCurl.stderr, /requires curl 8\.4\.0 or newer/);
    assert.equal(fs.existsSync(curlLog), false, 'outdated curl must make no network request');
    assert.equal(fs.existsSync(destination), false, 'outdated curl must create no output');

    const unparseableCurl = run(false, 'unknown');
    assert.notEqual(unparseableCurl.status, 0);
    assert.equal(fs.existsSync(curlLog), false);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
