import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  SCHEMA_VERSION,
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
  assert.deepEqual(
    out.checks.map((item) => item.code),
    ['spf', 'dkim', 'dmarc', 'dnssec', 'caa', 'mta_sts', 'tls_rpt', 'zone_transfer'],
  );
  assert.equal(out.checks.find((c) => c.code === 'zone_transfer').classification, 'inconclusive');
  assert.equal(out.checks.find((c) => c.code === 'spf').valid, true);
  assert.doesNotMatch(JSON.stringify(out), /@/);
});

test('sanitizes agent_readiness without blanket JSON-LD absence', () => {
  const out = sanitizeAgentReadiness(agentFixture, { siteId: SITE, origin: ORIGIN });
  assert.equal(out.endpoint, 'agent_readiness');
  const webmcp = out.signals.find((s) => s.code === 'webmcp');
  assert.equal(webmcp.classification, 'unknown');
  const jsonLd = out.signals.find((s) => s.code === 'json_ld');
  assert.equal(jsonLd.classification, 'unknown');
  assert.equal(jsonLd.note, 'static_signal_not_whole_site_structured_data');
  assert.equal(out.sourceNative.agentReadinessScore, 83);
  assert.doesNotMatch(JSON.stringify(out), /@/);
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
});

test('rejects agent_readiness URL host spoofing', () => {
  assert.throws(
    () =>
      sanitizeAgentReadiness(
        { ...agentFixture, requested_url: 'https://other.example/', final_url: 'https://other.example/' },
        { siteId: SITE, origin: ORIGIN },
      ),
    /must match origin host/,
  );
});

test('rejects unknown dns check classification', () => {
  const broken = structuredClone(dnsFixture);
  broken.spf = { classification: { status: 'definitely-secure' } };
  assert.throws(() => sanitizeDnsSecurity(broken, { siteId: SITE, origin: ORIGIN }), /unsupported classification/);
});

test('rejects oversized serialized provider payload bound', () => {
  const huge = 'x'.repeat(MAX_INPUT_BYTES + 1);
  assert.ok(Buffer.byteLength(huge, 'utf8') > MAX_INPUT_BYTES);
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
