import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
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
  const script = new URL('../scripts/domscan-sidecar.mjs', import.meta.url).pathname.replace(/^\//, '');
  const scriptPath = path.resolve(script);
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

test('spf valid true without explicit classification maps to present', () => {
  const minimal = structuredClone(dnsFixture);
  minimal.spf = { valid: true };
  const out = sanitizeDnsSecurity(minimal, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.checks.find((c) => c.code === 'spf').classification, 'present');
  assert.equal(out.checks.find((c) => c.code === 'spf').valid, true);
});
