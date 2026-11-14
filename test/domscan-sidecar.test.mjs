import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AGENT_SIGNALS,
  SCHEMA_VERSION,
  assertIsoUtc,
  parseHttpsOrigin,
  readBoundedJson,
  sanitizeAgentReadiness,
  sanitizeDnsSecurity,
  sanitizeDomscanEndpoint,
  MAX_INPUT_BYTES,
} from '../scripts/domscan-sidecar.mjs';

const ORIGIN = 'https://lowcountrydigitalworks.com';
const SITE = 'lowcountrydigitalworks';

const dnsFixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/domscan/dns-security-valid.json', import.meta.url), 'utf8'),
);
const agentFixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/domscan/agent-readiness-valid.json', import.meta.url), 'utf8'),
);

test('sanitizes dns_security with independent sidecar schema', () => {
  const out = sanitizeDnsSecurity(dnsFixture, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.schemaVersion, SCHEMA_VERSION);
  assert.equal(out.provider, 'domscan');
  assert.equal(out.endpoint, 'dns_security');
  assert.equal(out.evidenceOnly, true);
  assert.equal(out.origin, 'https://lowcountrydigitalworks.com');
  assert.deepEqual(
    out.checks.map((item) => item.code),
    ['spf', 'dkim', 'dmarc', 'dnssec', 'caa', 'mta_sts', 'tls_rpt', 'zone_transfer'],
  );
  assert.equal(out.checks.find((c) => c.code === 'zone_transfer').classification, 'inconclusive');
  assert.equal(out.checks.find((c) => c.code === 'caa').classification, 'absent');
  assert.equal(out.checks.find((c) => c.code === 'spf').valid, true);
  assert.equal(out.inputObservedAt, '2026-11-07T06:10:00.000Z');
  assert.equal('sourceObservedAt' in out, false);
  assert.doesNotMatch(JSON.stringify(out), /@/);
});

test('sanitizes agent_readiness with all twelve provider signals sorted', () => {
  const out = sanitizeAgentReadiness(agentFixture, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.endpoint, 'agent_readiness');
  assert.deepEqual(
    out.signals.map((s) => s.code),
    [...AGENT_SIGNALS].sort((a, b) => a.localeCompare(b)),
  );
  const webmcp = out.signals.find((s) => s.code === 'webmcp');
  assert.equal(webmcp.classification, 'unknown');
  assert.equal(out.signals.find((s) => s.code === 'oauth').classification, 'present');
  assert.equal(out.sourceNative.agentReadinessScore, 83);
  assert.equal(out.outcome, 'partial');
  assert.equal('sourceObservedAt' in out, false);
  assert.doesNotMatch(JSON.stringify(out), /json_ld|microdata|robots_ai|sitemap_ai/);
  assert.doesNotMatch(JSON.stringify(out), /@/);
});

test('missing agent signals surface explicit unknown', () => {
  const partial = structuredClone(agentFixture);
  delete partial.signals.agent_guide;
  const out = sanitizeAgentReadiness(partial, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.signals.find((s) => s.code === 'agent_guide').classification, 'unknown');
});

test('two runs serialize byte-identically', () => {
  const first = JSON.stringify(sanitizeAgentReadiness(agentFixture, { siteId: SITE, origin: ORIGIN }));
  const second = JSON.stringify(sanitizeAgentReadiness(agentFixture, { siteId: SITE, origin: ORIGIN }));
  assert.equal(first, second);
});

test('rejects origin host mismatch', () => {
  assert.throws(
    () => sanitizeDnsSecurity({ ...dnsFixture, domain: 'evil.example' }, { siteId: SITE, origin: ORIGIN }),
    /host does not match/,
  );
});

test('rejects malformed siteId and origin', () => {
  assert.throws(() => sanitizeDomscanEndpoint(dnsFixture, { siteId: 'Bad_Site', origin: ORIGIN, endpoint: 'dns_security' }));
  assert.throws(() => sanitizeDomscanEndpoint(dnsFixture, { siteId: SITE, origin: 'http://lowcountrydigitalworks.com', endpoint: 'dns_security' }));
  assert.throws(() => parseHttpsOrigin('https://lowcountrydigitalworks.com:8443/'), /non-default port/);
  assert.throws(() => parseHttpsOrigin('https://user:pass@lowcountrydigitalworks.com/'), /credentials/);
});

test('rejects agent_readiness URL identity spoofing', () => {
  assert.throws(
    () =>
      sanitizeAgentReadiness(
        { ...agentFixture, requested_url: 'https://other.example/', final_url: 'https://other.example/' },
        { siteId: SITE, origin: ORIGIN },
      ),
    /must match origin host/,
  );
  assert.throws(
    () =>
      sanitizeAgentReadiness(
        { ...agentFixture, requested_url: 'http://lowcountrydigitalworks.com/', final_url: 'https://lowcountrydigitalworks.com/' },
        { siteId: SITE, origin: ORIGIN },
      ),
    /must use https/,
  );
  assert.throws(
    () =>
      sanitizeAgentReadiness(
        { ...agentFixture, requested_url: 'https://lowcountrydigitalworks.com/path', final_url: 'https://lowcountrydigitalworks.com/' },
        { siteId: SITE, origin: ORIGIN },
      ),
    /canonical site root/,
  );
});

test('rejects non-Z and malformed checked_at', () => {
  assert.throws(() => assertIsoUtc('2026-11-07T06:10:00', 'checked_at'), /Z suffix/);
  assert.throws(() => assertIsoUtc('2026-11-07T06:10:00+00:00', 'checked_at'), /Z suffix/);
  assert.throws(() => assertIsoUtc('2026-02-30T06:10:00.000Z', 'checked_at'), /legitimate calendar/);
});

test('assertIsoUtc accepts second-only Z and canonicalizes to milliseconds', () => {
  assert.equal(assertIsoUtc('2026-11-07T06:21:18Z', 'checked_at'), '2026-11-07T06:21:18.000Z');
  const dns = structuredClone(dnsFixture);
  dns.checked_at = '2026-11-07T06:21:18Z';
  const out = sanitizeDnsSecurity(dns, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.inputObservedAt, '2026-11-07T06:21:18.000Z');
});

test('rejects unknown dns check classification', () => {
  const broken = structuredClone(dnsFixture);
  broken.spf = { classification: { status: 'definitely-secure' } };
  assert.throws(() => sanitizeDnsSecurity(broken, { siteId: SITE, origin: ORIGIN }), /unsupported classification/);
});

test('readBoundedJson rejects oversize file via real temp path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domscan-bound-'));
  const file = path.join(dir, 'oversize.json');
  try {
    const payload = `${' '.repeat(MAX_INPUT_BYTES)}x`;
    fs.writeFileSync(file, payload, 'utf8');
    assert.throws(() => readBoundedJson(file), /exceeds size bound/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI rejects oversize input file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domscan-cli-'));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.json');
  const scriptPath = fileURLToPath(new URL('../scripts/domscan-sidecar.mjs', import.meta.url));
  try {
    fs.writeFileSync(input, `${' '.repeat(MAX_INPUT_BYTES)}]`, 'utf8');
    assert.throws(
      () =>
        execFileSync(process.execPath, [scriptPath, '--site-id', SITE, '--origin', ORIGIN, '--endpoint', 'dns_security', '--input', input, '--output', output], {
          encoding: 'utf8',
        }),
      /exceeds size bound/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('endpoint router accepts only two endpoints', () => {
  assert.throws(() => sanitizeDomscanEndpoint(dnsFixture, { siteId: SITE, origin: ORIGIN, endpoint: 'structured_data' }));
});

test('preserves unknown and not_detected without promoting to absent', () => {
  const agent = structuredClone(agentFixture);
  agent.signals.llms_txt = { status: 'not_detected', method: 'static_html' };
  const out = sanitizeAgentReadiness(agent, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.signals.find((s) => s.code === 'llms_txt').classification, 'not_detected');
});

test('dmarc policy and agent score bounds', () => {
  const badPolicy = structuredClone(dnsFixture);
  badPolicy.dmarc = { classification: { status: 'present' }, policy: 'super-strict' };
  assert.throws(() => sanitizeDnsSecurity(badPolicy, { siteId: SITE, origin: ORIGIN }), /dmarc.policy/);

  const high = structuredClone(agentFixture);
  high.summary.score = 101;
  assert.throws(() => sanitizeAgentReadiness(high, { siteId: SITE, origin: ORIGIN }), /score must be/);
});

test('rejects invalid outcome and leaky caveats', () => {
  const badOutcome = structuredClone(agentFixture);
  badOutcome.outcome = 'definitely-complete';
  assert.throws(() => sanitizeAgentReadiness(badOutcome, { siteId: SITE, origin: ORIGIN }), /outcome/);

  const leaky = structuredClone(agentFixture);
  leaky.signals.oauth = { status: 'present', method: 'static_html', caveats: ['contact@evil.example'] };
  assert.throws(() => sanitizeAgentReadiness(leaky, { siteId: SITE, origin: ORIGIN }), /invalid shape/);
});

test('spf and dkim valid false without classification stays unknown not absent', () => {
  const spfInvalid = structuredClone(dnsFixture);
  spfInvalid.spf = { valid: false };
  const spfOut = sanitizeDnsSecurity(spfInvalid, { siteId: SITE, origin: ORIGIN });
  assert.equal(spfOut.checks.find((c) => c.code === 'spf').classification, 'unknown');
  assert.equal(spfOut.checks.find((c) => c.code === 'spf').valid, false);

  const dkimInvalid = structuredClone(dnsFixture);
  dkimInvalid.dkim = { valid: false };
  const dkimOut = sanitizeDnsSecurity(dkimInvalid, { siteId: SITE, origin: ORIGIN });
  assert.equal(dkimOut.checks.find((c) => c.code === 'dkim').classification, 'unknown');
});

test('spf valid true alone without classification stays unknown', () => {
  const minimal = structuredClone(dnsFixture);
  minimal.spf = { valid: true };
  const out = sanitizeDnsSecurity(minimal, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.checks.find((c) => c.code === 'spf').classification, 'unknown');
  assert.equal(out.checks.find((c) => c.code === 'spf').valid, true);
});

test('tls_rpt exists false maps to absent independently of valid flag', () => {
  const out = sanitizeDnsSecurity(dnsFixture, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.checks.find((c) => c.code === 'tls_rpt').classification, 'absent');
});

test('CLI rejects unknown and repeated flags before any source or output handling', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domscan-cli-args-'));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.json');
  const scriptPath = fileURLToPath(new URL('../scripts/domscan-sidecar.mjs', import.meta.url));
  const acceptedArgs = [
    '--site-id', SITE, '--origin', ORIGIN, '--endpoint', 'dns_security',
    '--input', input, '--output', output,
  ];
  try {
    fs.writeFileSync(input, JSON.stringify(dnsFixture), 'utf8');
    const accepted = spawnSync(process.execPath, [scriptPath, ...acceptedArgs], { encoding: 'utf8' });
    assert.equal(accepted.status, 0, accepted.stderr);
    const artifact = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(artifact.schemaVersion, SCHEMA_VERSION);
    assert.equal(artifact.endpoint, 'dns_security');

    const invalidSuffixes = [
      { options: ['--endpoint', 'agent_readiness'], expected: /Duplicate DomScan CLI option/ },
      { options: ['--not-supported', 'private@example.test'], expected: /Unrecognized DomScan CLI option/ },
      { options: ['--__proto__', 'private@example.test'], expected: /Unrecognized DomScan CLI option/ },
    ];
    for (const { options, expected } of invalidSuffixes) {
      fs.rmSync(output, { force: true });
      const rejected = spawnSync(process.execPath, [scriptPath, ...acceptedArgs, ...options], {
        encoding: 'utf8',
      });
      assert.notEqual(rejected.status, 0, 'ambiguous CLI admission must reject');
      assert.match(rejected.stderr, expected);
      assert.equal(fs.existsSync(output), false, 'rejection must not write a sidecar');
      assert.doesNotMatch(rejected.stderr, /private@example\.test/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('rejects same-file and hard-link DomScan output alias without destroying source bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domscan-output-alias-'));
  const scriptPath = fileURLToPath(new URL('../scripts/domscan-sidecar.mjs', import.meta.url));
  const input = path.join(dir, 'provider-input.json');
  const hardlink = path.join(dir, 'provider-hardlink.json');
  try {
    const original = JSON.stringify(dnsFixture, null, 2) + '\n';
    fs.writeFileSync(input, original, 'utf8');
    fs.linkSync(input, hardlink);
    for (const output of [input, hardlink]) {
      assert.throws(
        () => execFileSync(process.execPath, [
          scriptPath, '--site-id', SITE, '--origin', ORIGIN, '--endpoint', 'dns_security',
          '--input', input, '--output', output,
        ], { encoding: 'utf8' }),
        /input and output must not refer to the same file/,
      );
      assert.equal(fs.readFileSync(input, 'utf8'), original);
      assert.equal(fs.readFileSync(hardlink, 'utf8'), original);
      assert.equal(fs.readdirSync(dir).some((name) => name.startsWith('.domscan-sidecar-')), false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects symlink output without modifying its target', (t) => {
  if (process.platform === 'win32') {
    t.skip('Symlink setup is platform-permission-dependent; hosted Linux validates this case.');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domscan-output-link-'));
  const scriptPath = fileURLToPath(new URL('../scripts/domscan-sidecar.mjs', import.meta.url));
  const input = path.join(dir, 'in.json');
  const target = path.join(dir, 'sentinel.txt');
  const output = path.join(dir, 'out-link.json');
  try {
    fs.writeFileSync(input, JSON.stringify(dnsFixture));
    fs.writeFileSync(target, 'private sentinel\n');
    fs.symlinkSync(target, output);
    assert.throws(
      () => execFileSync(process.execPath, [
        scriptPath, '--site-id', SITE, '--origin', ORIGIN, '--endpoint', 'dns_security',
        '--input', input, '--output', output,
      ], { encoding: 'utf8' }),
      /output destination must be a regular file/,
    );
    assert.equal(fs.readFileSync(target, 'utf8'), 'private sentinel\n');
    assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
    assert.equal(fs.readdirSync(dir).some((name) => name.startsWith('.domscan-sidecar-')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('atomic DomScan output safely replaces regular output and keeps it on bad input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'domscan-output-atomic-'));
  const scriptPath = fileURLToPath(new URL('../scripts/domscan-sidecar.mjs', import.meta.url));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.json');
  const run = () => execFileSync(process.execPath, [
    scriptPath, '--site-id', SITE, '--origin', ORIGIN, '--endpoint', 'dns_security',
    '--input', input, '--output', output,
  ], { encoding: 'utf8' });
  try {
    fs.writeFileSync(input, JSON.stringify(dnsFixture));
    fs.writeFileSync(output, 'old valid output placeholder\n');
    assert.doesNotThrow(run);
    const artifact = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(artifact.schemaVersion, SCHEMA_VERSION);
    assert.equal(artifact.endpoint, 'dns_security');
    const sanitized = fs.readFileSync(output, 'utf8');

    fs.writeFileSync(input, '{invalid json');
    assert.throws(run, /SyntaxError|Unexpected token|Expected property name/);
    assert.equal(fs.readFileSync(output, 'utf8'), sanitized, 'invalid source must preserve prior output');
    assert.equal(fs.readdirSync(dir).some((name) => name.startsWith('.domscan-sidecar-')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
