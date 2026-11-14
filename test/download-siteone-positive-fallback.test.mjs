import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceScript = fileURLToPath(new URL('../scripts/download-siteone.sh', import.meta.url));
const officialDigest = '09278d958d4a087fa46093805cd33b085b96618001dd31d45c448ad724c9024e';
const officialBytes = 10876162;

test('synthetic valid official-API fallback installs only an integrity-verified archive', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX tar, bash and shell mocked curl required; hosted Linux runs this test.');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wqt-siteone-positive-fallback-'));
  try {
    const payloadDir = path.join(dir, 'payload');
    const fakeBinDir = path.join(dir, 'bin');
    const destDir = path.join(dir, 'output');
    const archive = path.join(dir, 'fixture.tar.gz');
    const log = path.join(dir, 'curl-attempts.log');
    const scriptCopy = path.join(dir, 'download-siteone-fixture.sh');
    fs.mkdirSync(payloadDir);
    fs.mkdirSync(fakeBinDir);
    const executable = Buffer.from('#!/bin/sh\n echo synthetic-only; do-not-execute\n');
    fs.writeFileSync(path.join(payloadDir, 'siteone-crawler'), executable, { mode: 0o755 });
    const createArchive = spawnSync('tar', ['-czf', archive, '-C', payloadDir, 'siteone-crawler'], {
      encoding: 'utf8',
    });
    assert.equal(createArchive.status, 0, createArchive.stderr);
    const fixtureBytes = fs.readFileSync(archive);
    const fixtureDigest = createHash('sha256').update(fixtureBytes).digest('hex');
    assert.notEqual(fixtureDigest, officialDigest);
    assert.notEqual(fixtureBytes.length, officialBytes);

    // Only the ephemeral test copy of the production script is re-pinned to a
    // synthetic local fixture. The original official pin remains untouched.
    const script = fs.readFileSync(sourceScript, 'utf8');
    assert.ok(script.includes(`EXPECTED_SHA256="${officialDigest}"`));
    assert.ok(script.includes(`EXPECTED_BYTES=${officialBytes}`));
    const fixtureScript = script
      .replace(`EXPECTED_SHA256="${officialDigest}"`, `EXPECTED_SHA256="${fixtureDigest}"`)
      .replace(`EXPECTED_BYTES=${officialBytes}`, `EXPECTED_BYTES=${fixtureBytes.length}`);
    assert.notEqual(fixtureScript, script);
    fs.writeFileSync(scriptCopy, fixtureScript, { mode: 0o700 });

    const mockCurl = `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'curl 8.16.0 (synthetic)\\n'
  exit 0
fi
printf '%s\\n' "$*" >> "$WQT_FALLBACK_CALLS"
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output" ]; then out="$arg"; fi
  prev="$arg"
done
case "$*" in
  *"/releases/download/v2.5.1/"*) exit 22 ;;
  *"/repos/janreges/siteone-crawler/releases/assets/459279687"*)
    cp "$WQT_FALLBACK_ARCHIVE" "$out"
    exit 0
    ;;
  *) exit 42 ;;
esac
`;
    fs.writeFileSync(path.join(fakeBinDir, 'curl'), mockCurl, { mode: 0o755 });
    const result = spawnSync('bash', [scriptCopy, destDir], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: fakeBinDir + path.delimiter + (process.env.PATH ?? ''),
        WQT_FALLBACK_CALLS: log,
        WQT_FALLBACK_ARCHIVE: archive,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Verified SiteOne Crawler artifact 2\.5\.1/);

    const installedPath = path.join(destDir, 'siteone-crawler');
    assert.deepEqual(fs.readFileSync(installedPath), executable);
    assert.ok((fs.statSync(installedPath).mode & 0o111) !== 0);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 2, 'one failed primary and one successful fallback');
    assert.equal(calls[0].trim().split(' ').at(-1),
      'https://github.com/janreges/siteone-crawler/releases/download/v2.5.1/siteone-crawler-v2.5.1-linux-x64.tar.gz');
    assert.equal(calls[1].trim().split(' ').at(-1),
      'https://api.github.com/repos/janreges/siteone-crawler/releases/assets/459279687');
    assert.match(calls[1], /Accept: application\/octet-stream/);
    assert.match(calls[1], /--proto-redir =https/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
