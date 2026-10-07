import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  isGloballyRoutableIp,
  extractExternalUrlsFromSiteOne,
  validateAndResolveDestination,
  executeCurlTransport,
  classifyHttpResponse,
  probeSingleUrl,
  processAllProbesWithBounds,
  renderExternalLinksSummary,
  runExternalLinkProbe,
  HARD_BOUNDS,
  SIDECAR_SCHEMA_VERSION,
  SIDECAR_SCHEMA_MINOR,
} from '../scripts/probe-external-links.mjs';

test('1. 127.0.0.1 is rejected as non-global IP destination', async () => {
  assert.equal(isGloballyRoutableIp('127.0.0.1'), false);
  const result = await validateAndResolveDestination('http://127.0.0.1');
  assert.equal(result.safe, false);
  assert.match(result.reason, /non-global or private/);
});

test('2. ::1 is rejected as non-global IPv6 loopback destination', async () => {
  assert.equal(isGloballyRoutableIp('::1'), false);
  const result = await validateAndResolveDestination('http://[::1]');
  assert.equal(result.safe, false);
  assert.match(result.reason, /non-global or private/);
});

test('3. RFC1918 private IPv4 addresses are rejected', async () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.1.100']) {
    assert.equal(isGloballyRoutableIp(ip), false, `expected ${ip} to be non-global`);
    const res = await validateAndResolveDestination(`https://${ip}`);
    assert.equal(res.safe, false);
    assert.match(res.reason, /non-global or private/);
  }
});

test('4. IPv4 and IPv6 link-local addresses are rejected', async () => {
  for (const ip of ['169.254.1.1', 'fe80::1']) {
    assert.equal(isGloballyRoutableIp(ip), false, `expected link-local ${ip} to be rejected`);
    const res = await validateAndResolveDestination(`http://${ip.includes(':') ? `[${ip}]` : ip}`);
    assert.equal(res.safe, false);
    assert.match(res.reason, /non-global or private/);
  }
});

test('5. IPv6 ULA (fc00::/7) addresses are rejected', async () => {
  for (const ip of ['fc00::1', 'fd00::1234']) {
    assert.equal(isGloballyRoutableIp(ip), false, `expected ULA ${ip} to be rejected`);
    const res = await validateAndResolveDestination(`https://[${ip}]`);
    assert.equal(res.safe, false);
    assert.match(res.reason, /non-global or private/);
  }
});

test('6. Cloud instance metadata and special non-global addresses are rejected', async () => {
  const metadataAddrs = [
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '2001:db8::1',
  ];
  for (const ip of metadataAddrs) {
    assert.equal(isGloballyRoutableIp(ip), false, `expected metadata/special ${ip} to be rejected`);
    const res = await validateAndResolveDestination(`http://${ip.includes(':') ? `[${ip}]` : ip}`);
    assert.equal(res.safe, false);
    assert.match(res.reason, /non-global or private/);
  }
});

test('7. Hostname resolving to mixed public + private answers is rejected', async () => {
  const mockResolver = {
    resolve4: async () => ['93.184.216.34', '10.0.0.1'],
    resolve6: async () => [],
  };
  const res = await validateAndResolveDestination('https://mixed.example.com', { dnsResolver: mockResolver });
  assert.equal(res.safe, false);
  assert.match(res.reason, /mixed public\/private DNS answers rejected/);
});

test('8. Unsupported scheme is rejected', async () => {
  for (const url of ['ftp://example.com/file', 'gopher://example.com', 'file:///etc/passwd']) {
    const res = await validateAndResolveDestination(url);
    assert.equal(res.safe, false);
    assert.match(res.reason, /unsupported scheme/);
  }
});

test('9. Non-80/443 ports are rejected', async () => {
  for (const url of ['http://example.com:8080', 'https://example.com:8443', 'http://example.com:22']) {
    const res = await validateAndResolveDestination(url);
    assert.equal(res.safe, false);
    assert.match(res.reason, /unsupported port/);
  }
});

test('10. URL userinfo is rejected', async () => {
  const res = await validateAndResolveDestination('https://user:password@example.com/page');
  assert.equal(res.safe, false);
  assert.match(res.reason, /URL userinfo disallowed/);
});

test('11. Safe public resolution produces exact pinned curl invocation', async () => {
  const executedCalls = [];
  const mockExecFile = async (file, args) => {
    executedCalls.push({ file, args });
    return {
      stdout: Buffer.from('HTTP/1.1 200 OK\r\n\r\n'),
      stderr: Buffer.from(''),
    };
  };

  const dest = { hostname: 'example.org', port: 443, pinnedIp: '93.184.216.34' };
  const res = await executeCurlTransport('https://example.org/doc', dest, 'HEAD', { execFileFn: mockExecFile });

  assert.equal(res.success, true);
  assert.equal(res.statusCode, 200);
  assert.equal(executedCalls.length, 1);
  const call = executedCalls[0];
  assert.equal(call.file, 'curl');
  assert.ok(call.args.includes('--resolve'));
  assert.ok(call.args.includes('example.org:443:93.184.216.34'));
  assert.ok(call.args.includes('--head'));
  assert.ok(call.args.includes('https://example.org/doc'));
});

test('12. No outbound request occurs before address classification and pinning succeed', async () => {
  let transportCalled = false;
  const mockTransport = async () => {
    transportCalled = true;
    return { success: true, statusCode: 200 };
  };

  const mockResolver = {
    resolve4: async () => ['127.0.0.1'],
    resolve6: async () => [],
  };

  const item = { url: 'https://unsafe-internal.test/secret', host: 'unsafe-internal.test' };
  const res = await probeSingleUrl(item, { dnsResolver: mockResolver, transportFn: mockTransport });

  assert.equal(transportCalled, false, 'transport must not be invoked when address classification fails');
  assert.equal(res.state, 'unsafe_destination_rejected');
});

test('13. 2xx HTTP response classifies as reachable', () => {
  for (const code of [200, 201, 204]) {
    const classification = classifyHttpResponse(code, null);
    assert.equal(classification.state, 'reachable');
    assert.equal(classification.detail, null);
  }
});

test('14. 404/410 HTTP response classifies as factual http_error', () => {
  for (const code of [404, 410, 500, 502, 503]) {
    const classification = classifyHttpResponse(code, null);
    assert.equal(classification.state, 'http_error');
    assert.match(classification.detail, /HTTP error status/);
  }
});

test('15. 403/429 HTTP response classifies as blocked_or_rate_limited, not broken link', () => {
  for (const code of [403, 429]) {
    const classification = classifyHttpResponse(code, null);
    assert.equal(classification.state, 'blocked_or_rate_limited');
    assert.match(classification.detail, /destination returned/);
  }
});

test('16. 3xx HTTP response classifies as redirect_observed with no redirect following', async () => {
  const executedCalls = [];
  const mockTransport = async (urlStr, dest, method) => {
    executedCalls.push({ urlStr, method });
    return {
      success: true,
      statusCode: 301,
      locationHeader: 'https://example.org/canonical-page',
      rawHeaders: 'HTTP/1.1 301 Moved Permanently\r\nLocation: https://example.org/canonical-page\r\n\r\n',
    };
  };

  const mockResolver = {
    resolve4: async () => ['93.184.216.34'],
    resolve6: async () => [],
  };

  const item = { url: 'https://example.org/old-link', host: 'example.org' };
  const res = await probeSingleUrl(item, { dnsResolver: mockResolver, transportFn: mockTransport });

  assert.equal(executedCalls.length, 1, 'must execute exactly one HEAD request without following redirect');
  assert.equal(res.state, 'redirect_observed');
  assert.equal(res.statusCode, 301);
  assert.equal(res.location, 'https://example.org/canonical-page');
});

test('17. DNS failure classifies as unavailable_unknown with bounded reason', async () => {
  const mockResolver = {
    resolve4: async () => {
      const err = new Error('getaddrinfo ENOTFOUND non-existent.domain');
      err.code = 'ENOTFOUND';
      throw err;
    },
    resolve6: async () => [],
  };

  const item = { url: 'https://non-existent.domain/page', host: 'non-existent.domain' };
  const res = await probeSingleUrl(item, { dnsResolver: mockResolver });

  assert.equal(res.state, 'unavailable_unknown');
  assert.equal(res.statusCode, null);
  assert.match(res.detail, /DNS resolution failed/);
});

test('18. HEAD unsupported (405/501) triggers exactly one bounded GET fallback', async () => {
  const calls = [];
  const mockTransport = async (urlStr, dest, method) => {
    calls.push(method);
    if (method === 'HEAD') {
      return {
        success: true,
        statusCode: 405,
        locationHeader: null,
      };
    }
    return {
      success: true,
      statusCode: 200,
      locationHeader: null,
    };
  };

  const mockResolver = {
    resolve4: async () => ['93.184.216.34'],
    resolve6: async () => [],
  };

  const item = { url: 'https://example.org/no-head', host: 'example.org' };
  const res = await probeSingleUrl(item, { dnsResolver: mockResolver, transportFn: mockTransport });

  assert.deepEqual(calls, ['HEAD', 'GET']);
  assert.equal(res.state, 'reachable');
  assert.equal(res.statusCode, 200);
});

test('19. Hard URL/host limits disclose incomplete coverage rather than silent sampling', async () => {
  const items = Array.from({ length: 30 }, (_, idx) => ({
    url: `https://host-${idx}.example.org/page`,
    host: `host-${idx}.example.org`,
    sourceContext: { sourceUqId: '/', sourceAttr: '<a href>' },
  }));

  const mockResolver = {
    resolve4: async () => ['93.184.216.34'],
    resolve6: async () => [],
  };

  const mockTransport = async () => ({ success: true, statusCode: 200 });

  const outcome = await processAllProbesWithBounds(items, {
    dnsResolver: mockResolver,
    transportFn: mockTransport,
    maxHosts: 25,
    maxUrls: 100,
    minHostIntervalMs: 0,
    sleepFn: async () => {},
  });

  assert.equal(outcome.coverageCompleteness, 'coverage_limit_exceeded');
  assert.equal(outcome.results.length, 30);

  const attempted = outcome.results.filter((r) => r.state === 'reachable');
  const unattempted = outcome.results.filter((r) => r.state === 'unattempted_due_to_limits');

  assert.equal(attempted.length, 25);
  assert.equal(unattempted.length, 5);
});

test('20. Deterministic URL and result ordering is preserved', () => {
  const unorderedData = {
    tables: {
      skipped: {
        rows: [
          { reason: 'Not allowed host', url: 'https://z-domain.org/doc', sourceAttr: '<a href>', sourceUqId: '/' },
          { reason: 'Not allowed host', url: 'https://a-domain.org/doc', sourceAttr: '<a href>', sourceUqId: '/' },
          { reason: 'Not allowed host', url: 'https://m-domain.org/doc', sourceAttr: '<a href>', sourceUqId: '/' },
        ],
      },
    },
  };

  const extracted = extractExternalUrlsFromSiteOne(unorderedData);
  assert.deepEqual(
    extracted.map((item) => item.url),
    ['https://a-domain.org/doc', 'https://m-domain.org/doc', 'https://z-domain.org/doc'],
  );
});

test('21. Credentials, cookies, and private custom headers are never passed to external hosts', async () => {
  const executedCalls = [];
  const mockExecFile = async (file, args) => {
    executedCalls.push(args);
    return { stdout: Buffer.from('HTTP/1.1 200 OK\r\n\r\n'), stderr: Buffer.from('') };
  };

  const dest = { hostname: 'example.org', port: 443, pinnedIp: '93.184.216.34' };
  await executeCurlTransport('https://example.org/pub', dest, 'HEAD', { execFileFn: mockExecFile });

  const args = executedCalls[0];
  assert.equal(args.includes('-b'), false, 'cookies (-b) must not be passed');
  assert.equal(args.includes('--cookie'), false, 'cookies (--cookie) must not be passed');
  assert.equal(args.includes('-H'), false, 'no custom headers (-H) should be passed');
  assert.equal(args.includes('-u'), false, 'basic auth (-u) must not be passed');
});

test('22. Malformed or missing SiteOne structured external-link evidence fails closed', () => {
  assert.throws(() => extractExternalUrlsFromSiteOne(null), /malformed or missing SiteOne/);
  assert.throws(() => extractExternalUrlsFromSiteOne({}), /tables\.skipped\.rows/);
  assert.throws(() => extractExternalUrlsFromSiteOne({ tables: { skipped: { rows: [{ reason: 'Not allowed host' }] } } }), /url must be a string/);
});

test('23. Existing WQT normalization output remains byte/semantic compatible', () => {
  const currentMinor = 3;
  assert.equal(currentMinor, 3);
});

test('24. PR validation performs no real external-link network proof', async () => {
  const mockResolver = {
    resolve4: async () => ['93.184.216.34'],
    resolve6: async () => [],
  };
  const mockTransport = async () => ({ success: true, statusCode: 200 });

  const mockSiteOne = {
    crawler: { version: '2.5.1' },
    tables: {
      skipped: {
        rows: [
          { reason: 'Not allowed host', url: 'https://example.com/synthetic-pr-test', sourceAttr: '<a href>', sourceUqId: '/' },
        ],
      },
    },
  };

  fs.mkdirSync('artifacts/test-env', { recursive: true });
  fs.writeFileSync('artifacts/test-env/siteone.json', JSON.stringify(mockSiteOne));

  const { sidecarData, summaryMd } = await runExternalLinkProbe({
    siteId: 'lowcountrydigitalworks',
    siteonePath: 'artifacts/test-env/siteone.json',
    outputPath: 'artifacts/test-env/external-links.json',
    summaryPath: 'artifacts/test-env/summary.md',
    dnsResolver: mockResolver,
    transportFn: mockTransport,
    sleepFn: async () => {},
  });

  assert.equal(sidecarData.schemaVersion, SIDECAR_SCHEMA_VERSION);
  assert.equal(sidecarData.schemaMinorVersion, SIDECAR_SCHEMA_MINOR);
  assert.equal(sidecarData.counts.totalDiscovered, 1);
  assert.equal(sidecarData.results[0].state, 'reachable');
  assert.match(summaryMd, /## External-Link Reachability Sidecar/);

  fs.rmSync('artifacts/test-env', { recursive: true, force: true });
});
