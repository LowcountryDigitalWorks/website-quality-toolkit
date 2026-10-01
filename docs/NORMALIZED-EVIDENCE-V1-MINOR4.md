# Normalized Evidence v1 — Minor 4

The normalized evidence major contract remains:

`ldw.website-quality.v1`

Minor 4 is additive. It introduces an optional provider-neutral compression-delivery evidence source and does not remove, rename, reinterpret, or downgrade any existing SiteOne or Lighthouse field.

## Why this exists

SiteOne 2.5.1 can report a Brotli-specific warning while a capable client may legitimately receive another accepted HTTP content-coding such as Zstandard or Gzip.

The retained SiteOne JSON does not expose per-response `Content-Encoding`, so the existing artifact cannot distinguish:

- Brotli;
- Zstandard;
- Gzip;
- no content coding;
- unknown/other content coding.

Minor 4 adds a separate controlled probe so WQT can retain the original SiteOne warning while also recording what content coding a capable client actually observed.

## Raw compression-probe contract

The workflow creates:

`artifacts/raw/compression.json`

with raw schema:

`ldw.wqt-compression-probe.v1`

The probe:

- receives the already-resolved canonical target origin;
- receives the current raw SiteOne report;
- selects only unique SiteOne-discovered URLs whose SiteOne status was `200`;
- permits only exact-origin HTTPS URLs;
- caps the probe set at 64 URLs;
- sends `GET` requests with `Accept-Encoding: zstd, br, gzip`;
- does not follow redirects automatically;
- records response status, `Content-Encoding`, `Content-Type`, and `Content-Length` when present;
- records deterministic encoding/resource classifications;
- introduces no free-form URL input and no provider API.

The raw artifact retains per-URL evidence. Normalized evidence does not copy the raw sample rows.

## Encoding classification

Accepted observed content-coding classes are:

- `zstd`;
- `br`;
- `gzip`;
- `none` for an absent/identity coding;
- `unknown` for any other or compound coding.

This is evidence classification only. It does not establish that one accepted algorithm is preferable to another.

## Resource classification

The probe conservatively classifies response media types as:

- `compressible`;
- `non-compressible`;
- `unknown`.

The compressible class is limited to text and common structured/web text formats such as HTML, CSS, JavaScript, JSON, XML, SVG, manifest JSON, and WebAssembly.

No minimum response-size threshold is invented. A small compressible response may legitimately be unencoded and is recorded as such without becoming an LDW quality failure.

## Normalized source

When compression raw evidence is supplied, normalized evidence may add:

`sources.compression`

with one observation:

`source = "compression"`
`code = "delivery-encoding"`

Typed count facts are:

- `compression-sample-count`;
- `compressible-sample-count`;
- `zstd-response-count`;
- `brotli-response-count`;
- `gzip-response-count`;
- `unencoded-response-count`;
- `unknown-encoding-response-count`;
- `non-200-response-count`.

All count facts use:

- `valueType: "number"`;
- `unit: "count"`.

The normalized source also records the exact requested `Accept-Encoding` value.

## Summary behavior

For `schemaMinorVersion >= 4`, the concise summary may add a Compression Delivery section when the normalized compression source is present.

The section reports observed counts only.

It does not:

- replace the SiteOne Brotli warning;
- downgrade SiteOne source status;
- apply a Cloudflare-specific rule;
- declare an LDW quality threshold;
- automatically remediate compression.

Older minor-version artifacts remain readable and do not inherit minor-4 compression semantics merely because similarly named fields appear.

## Failure semantics

Normalization fails closed if the raw compression evidence:

- has the wrong raw schema identifier;
- names a different target origin;
- claims a different requested `Accept-Encoding`;
- does not use manual redirect semantics;
- contains more than 64 samples;
- contains an off-origin sample;
- duplicates a sample URL;
- contains malformed status/length fields;
- contains a resource or encoding classification that contradicts the observed headers.

## Compatibility

Consumers that only understand earlier minor versions may ignore the additive compression source.

Consumers that depend on compression semantics should require:

`schemaMinorVersion >= 4`

Historical minor-1, minor-2, and minor-3 artifacts are not rewritten.
