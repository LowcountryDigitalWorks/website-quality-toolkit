import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  ACCEPT_ENCODING,
  classifyContentEncoding,
  classifyResourceClass,
  collectCompressionEvidence,
  probeUrl,
  requestOptions,
  selectProbeUrls,
} from '../scripts/collect-compression.mjs';

test('classifies accepted modern encodings without treating unknown values as success', () => {
  assert.equal(classifyContentEncoding('zstd'), 'zstd');
  assert.equal(classifyContentEncoding('br'), 'br');
  assert.equal(classifyContentEncoding('gzip'), 'gzip');
  assert.equal(classifyContentEncoding('identity'), 'none');
  assert.equal(classifyContentEncoding(null), 'none');
  assert.equal(classifyContentEncoding(''), 'none');
  assert.equal(classifyContentEncoding('deflate'), 'unknown');
  assert.equal(classifyContentEncoding('gzip, br'), 'unknown');
});

test('classifies resource types conservatively without inventing a size threshold', () => {
  assert.equal(classifyResourceClass('text/html; charset=utf-8'), 'compressible');
  assert.equal(classifyResourceClass('application/javascript'), 'compressible');
  assert.equal(classifyResourceClass('application/problem+json'), 'compressible');
  assert.equal(classifyResourceClass('image/svg+xml'), 'compressible');
  assert.equal(classifyResourceClass('image/png'), 'non-compressible');
  assert.equal(classifyResourceClass('application/pdf'), 'non-compressible');
  assert.equal(classifyResourceClass(null), 'unknown');
  assert.equal(classifyResourceClass('application/x-custom'), 'unknown');
});

test('selects only exact same-origin SiteOne 200 URLs and deduplicates deterministically', () => {
  const siteone = {
    results: [
      { url: 'https://example.test/b', status: '200' },
      { url: 'https://cdn.example.test/a', status: '200' },
      { url: 'https://example.test/a', status: '200' },
      { url: 'https://example.test/a', status: '200' },
      { url: 'https://example.test/redirect', status: '301' },
      { url: 'http://example.test/insecure', status: '200' },
    ],
  };
  assert.deepEqual(selectProbeUrls(siteone, 'https://example.test'), [
    'https://example.test/a',
    'https://example.test/b',
  ]);
});

test('request options advertise zstd, Brotli and gzip using GET', () => {
  const options = requestOptions();
  assert.equal(options.method, 'GET');
  assert.equal(options.headers['Accept-Encoding'], ACCEPT_ENCODING);
  assert.match(options.headers['User-Agent'], /LDW-Website-Quality-Compression-Probe/);
});

test('probeUrl records response headers and never relies on automatic decompression', async () => {
  let capturedUrl;
  let capturedOptions;
  const requestImpl = (url, options, callback) => {
    capturedUrl = url;
    capturedOptions = options;
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = (error) => req.emit('error', error);
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {
        'content-encoding': 'zstd',
        'content-type': 'text/html; charset=utf-8',
        'content-length': '1234',
      };
      res.resume = () => queueMicrotask(() => res.emit('end'));
      callback(res);
    };
    return req;
  };

  const result = await probeUrl('https://example.test/', { requestImpl });
  assert.equal(capturedUrl, 'https://example.test/');
  assert.equal(capturedOptions.method, 'GET');
  assert.equal(capturedOptions.headers['Accept-Encoding'], ACCEPT_ENCODING);
  assert.deepEqual(result, {
    url: 'https://example.test/',
    statusCode: 200,
    contentEncoding: 'zstd',
    encodingClass: 'zstd',
    contentType: 'text/html; charset=utf-8',
    resourceClass: 'compressible',
    contentLength: 1234,
  });
});

test('collectCompressionEvidence only probes the selected SiteOne URLs', async () => {
  const calls = [];
  const siteone = {
    results: [
      { url: 'https://example.test/', status: '200' },
      { url: 'https://example.test/app.js', status: '200' },
      { url: 'https://other.example/', status: '200' },
    ],
  };
  const evidence = await collectCompressionEvidence({
    target: 'https://example.test',
    siteone,
    probe: async (url) => {
      calls.push(url);
      return {
        url,
        statusCode: 200,
        contentEncoding: 'gzip',
        encodingClass: 'gzip',
        contentType: 'text/plain',
        resourceClass: 'compressible',
        contentLength: null,
      };
    },
  });

  assert.deepEqual(calls, [
    'https://example.test/',
    'https://example.test/app.js',
  ]);
  assert.equal(evidence.schemaVersion, 'ldw.wqt-compression-probe.v1');
  assert.equal(evidence.target, 'https://example.test');
  assert.equal(evidence.request.acceptEncoding, ACCEPT_ENCODING);
  assert.equal(evidence.request.redirectPolicy, 'manual');
  assert.equal(evidence.samples.length, 2);
});

test('selection fails closed on malformed SiteOne evidence and an unbounded URL set', () => {
  assert.throws(() => selectProbeUrls({}, 'https://example.test'), /results/);
  assert.throws(
    () => selectProbeUrls({ results: [{ url: 'not a url', status: '200' }] }, 'https://example.test'),
    /absolute URL/,
  );
  assert.throws(
    () => selectProbeUrls({
      results: Array.from({ length: 65 }, (_, index) => ({
        url: `https://example.test/${index}`,
        status: '200',
      })),
    }, 'https://example.test'),
    /bounded maximum/,
  );
});
