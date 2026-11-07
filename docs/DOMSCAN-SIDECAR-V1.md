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
| `origin` | canonical `https://<host>` (no credentials, non-default port, path, query, or hash) |
| `endpoint` | `dns_security` or `agent_readiness` |
| `inputObservedAt` | provider `checked_at` (UTC ISO-8601 with `Z`, second- or millisecond-precision); canonicalized to `…sssZ`; sole observed timestamp in output |

`input.domain` must match `origin` host. `agent_readiness` `requested_url` / `final_url` must be exactly `https://<host>/`. Normalization **fails closed** on http, credentials, port drift, path/query/hash spoofing, or malformed timestamps.

Repeated runs with the same local input bytes and trusted `--site-id` / `--origin` / `--endpoint` context produce **byte-identical** JSON (no nondeterministic processing clock).

## Classifications

Allowed normalized check `classification` values:

`present`, `absent`, `unknown`, `not_detected`, `not_applicable`, `inconclusive`

Provider `valid: false` on SPF/DKIM does **not** imply `absent` (invalid ≠ non-existent); use explicit `classification` or `exists` evidence. `valid: true` alone does not imply `present`.

Provider rubric scores (for example summary `score: 83`) may appear only as **source-native** contextual fields and are **not** LDW/GAS quality scores.

## Agent readiness signals

The sidecar normalizes the provider’s twelve `agent_readiness.signals` keys only: `webmcp`, `remote_mcp`, `openapi`, `llms_txt`, `api_catalog`, `mcp_server_card`, `agent_skills`, `oauth`, `markdown`, `web_bot_auth`, `sitemap_markdown`, `agent_guide` (sorted in output). Missing keys become explicit **`unknown`**. This slice does **not** ingest `structured_data`, JSON-LD, or Microdata endpoints and must not emit whole-site structured-data claims. `webmcp` with `runtime_required` stays **unknown**, not absent.

Input files are read through a single bounded file descriptor (max 256 KiB); no separate stat-then-read path.

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
