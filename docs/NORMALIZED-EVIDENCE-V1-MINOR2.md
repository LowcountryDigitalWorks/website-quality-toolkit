# Normalized Evidence Contract — `ldw.website-quality.v1` Minor 2

This document defines the current additive normalized-evidence contract introduced by WQT-SEM-001. Historical Baseline 0.1/0.2/0.3 documents remain unchanged records of the contract that existed when those baselines were accepted.

## Version semantics

- `schemaVersion` remains `ldw.website-quality.v1`.
- `schemaMinorVersion` is `2`.
- Minor 2 is additive: it introduces bounded typed facts on reviewed SiteOne observations without removing, renaming, or reinterpreting existing fields.
- The normalizer emits minor 2 only. There is no runtime minor-1 compatibility mode.
- Historical artifacts are not rewritten. `test/fixtures/normalized-v1-minor1.json` preserves the accepted minor-1 synthetic contract generated from starting main `3a03f1c789a35721b70c9e218a5bb464154e4188` with the existing SiteOne/Lighthouse fixtures.
- Downstream consumers that depend on typed facts must deliberately opt into `schemaMinorVersion >= 2`; they must not silently interpret minor 2 using minor-1 mapping semantics.

## SiteOne `facts`

`facts` is optional and applies only to normalized SiteOne observations. Lighthouse observations do not receive `facts`.

When no reviewed extractor applies to a SiteOne finding, the `facts` property is omitted. An empty `facts` array is not emitted merely for consistency.

Each fact is a closed JSON object with only these keys:

- required `id`;
- required `valueType`;
- required `value`;
- optional `unit`.

Contract bounds:

- at most 8 facts per SiteOne finding;
- `id`: ASCII pattern `^[a-z0-9][a-z0-9-]{0,63}$` (maximum 64 code units);
- `unit`, when present: ASCII pattern `^[a-z][a-z0-9-]{0,31}$` (maximum 32 code units);
- `valueType`: exactly `number`, `text`, or `boolean`;
- `value` may be `null` only for explicit unknown/missingness while preserving the declared `valueType`;
- non-null numeric values must be finite and have absolute value no greater than `Number.MAX_SAFE_INTEGER`;
- non-null text values are limited to 256 JavaScript string code units;
- non-null boolean values must be JSON booleans;
- unexpected fact keys fail closed;
- duplicate fact IDs within one observation fail closed;
- facts are sorted by ASCII fact ID ascending with a locale-independent comparator.

The two approved count facts additionally require `valueType: "number"` and `unit: "count"`. A non-null count value must be a non-negative safe integer.

`null` and zero are different states. `null` means explicit unknown/missingness. `0` is an observed numeric value and remains `0`.

## Approved extractor 1 — `static-assets-short-cache`

Exactly one fact is emitted:

```json
{
  "id": "affected-resource-count",
  "valueType": "number",
  "value": 11,
  "unit": "count"
}
```

The value is derived only from SiteOne 2.5.1 `results[]`. The human-readable summary message is never parsed.

For a matching `static-assets-short-cache` finding:

1. `results` must be an array or normalization fails closed.
2. A candidate row is a JSON object with a parseable absolute URL.
3. Candidate `status` must equal string `"200"`.
4. Candidate URL hostname must be internal to the WQT target. Hostnames compare exactly after removing at most one leading `www.` from each side.
5. Eligible SiteOne content-type IDs are exactly `2`, `3`, `4`, `5`, `6`, `7`, and `11` (Script, Stylesheet, Image, Video, Font, Document, Audio).
6. For each eligible candidate, `cacheTypeFlags` must be a non-negative safe integer. `cacheLifetime` must be either `null` or a non-negative safe integer. Malformed required cache fields fail closed.
7. A row is classified as uncacheable and excluded when flag `2048` (`no-store`) or `32768` (no cache headers) is set.
8. Otherwise the row is counted when flag `1024` (`no-cache`) is set, `cacheLifetime === null`, or `cacheLifetime < 86400`.
9. Otherwise `cacheLifetime >= 86400` is long-lived and is not counted.
10. The observed result is emitted even when the count is `0`.

The checked-in fixture is synthetic. Real Gate #25 artifacts used to verify the rule are not committed.

## Approved extractor 2 — `redirects`

Exactly one fact is emitted:

```json
{
  "id": "redirect-count",
  "valueType": "number",
  "value": 1,
  "unit": "count"
}
```

The value is `raw.tables.redirects.rows.length`. The display message is never parsed.

For a matching `redirects` finding:

- `tables`, `tables.redirects`, and `tables.redirects.rows` must exist with `rows` as an array or normalization fails closed;
- every row must be a plain JSON object;
- every row must contain string `statusCode`, `url`, `targetUrl`, and `sourceUqId` values;
- `statusCode` must be a SiteOne redirect status from `301` through `308` inclusive;
- an empty rows array is an observed count of `0`.

The extractor counts structured rows and does not assign semantic meaning to `targetUrl` placeholders.

## Display message and malformed-source rules

`sourceStatus` and `message` remain part of each normalized SiteOne observation. `message` is display/provenance evidence only; it is not canonical structured semantics.

For either approved finding, required structured source data that is missing or malformed causes normalization to fail closed. The normalizer never recovers a fact from message prose.

Changing only a message while keeping the finding code, source status, and structured source data unchanged must produce identical facts.

## Raw-payload boundary

Minor 2 does not export provider payloads. Normalized evidence must not copy or embed SiteOne `results[]`, `tables{}`, `options{}`, the crawler raw payload, or an equivalent wholesale provider dump. Only the reviewed typed facts are added.

## Lighthouse boundary

Lighthouse observation structure is unchanged from minor 1. Existing score, `numericValue`, `numericUnit`, ordering, and null behavior are preserved. The only artifact-level version change for Lighthouse-only semantics is `schemaMinorVersion: 1 -> 2`.

## Current extractor set

Minor 2 authorizes exactly two SiteOne fact extractors:

1. `static-assets-short-cache` → `affected-resource-count`;
2. `redirects` → `redirect-count`.

No recommendation, remediation, priority, severity policy, LDW threshold, or third extractor is part of this contract.
