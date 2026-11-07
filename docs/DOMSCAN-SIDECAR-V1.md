# DomScan offline sidecar (`ldw.wqt-domscan-sidecar.v1`)

**Status:** source-only companion evidence; **not** `ldw.website-quality.v1` and **not** GAS GEM input.

This module sanitizes **already acquired**, locally supplied DomScan JSON for two endpoints only:

- `dns_security`
- `agent_readiness`

It is **offline**: no provider HTTP, no DNS queries, no crawl, no env secrets, no scheduler, and no WQT workflow/registry change. Output is one sanitized JSON artifact **per endpoint**, never merged into SiteOne/Lighthouse normalized minor3.

## Identity and provenance

Each artifact binds:

| Field | Rule |
| --- | --- |
| `schemaVersion` | always `ldw.wqt-domscan-sidecar.v1` |
| `provider` | always `domscan` |
| `siteId` | opaque WQT allowlist id (pattern matches WQT resolver) |
| `origin` | canonical `https://` origin for the authorized target |
| `endpoint` | `dns_security` or `agent_readiness` |
| `inputObservedAt` | from provider `checked_at` |
| `sourceObservedAt` | normalization time (CLI run, UTC ISO) |

`input.domain` / URL host must match `origin` host exactly or normalization **fails closed**.

## Classifications

Allowed normalized check `classification` values:

`present`, `absent`, `unknown`, `not_detected`, `not_applicable`, `inconclusive`

Provider rubric scores (for example summary `score: 83`) may appear only as **source-native** contextual fields and are **not** LDW/GAS quality scores.

## Agent readiness caveats

Static DomScan agent signals must not imply absent Schema.org/JSON-LD for the whole site when structured-data was not executed here. `webmcp` static `unknown` with `runtime_required` remains **unknown**, not absent.

## CLI

```bash
node scripts/domscan-sidecar.mjs \
  --site-id lowcountrydigitalworks \
  --origin https://lowcountrydigitalworks.com \
  --endpoint dns_security \
  --input path/to/local-dns_security.json \
  --output path/to/sanitized-dns_security.json
```

Redirection and network are forbidden by design; only local file read/write.
