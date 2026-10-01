# Normalized Evidence v1 — Minor 3

Baseline 0.3 continues to use the major normalized evidence contract:

`ldw.website-quality.v1`

Minor 3 is an additive evidence-semantic change. It does not remove, rename, reinterpret, or downgrade any existing field or SiteOne source status.

## Additive change

When SiteOne emits the summary observation:

`aplCode: "skipped"`

the normalized observation may now include these typed count facts, derived only from `tables.skipped.rows`:

- `skipped-url-count`
- `external-not-allowed-host-count`
- `internal-skipped-url-count`
- `other-skipped-url-count`

All four facts use:

- `valueType: "number"`
- `unit: "count"`

## Classification

The target relationship is derived from the structured skipped URL, not the summary prose.

- An HTTP(S) skipped URL whose normalized hostname matches the scan target (treating the `www.` variant as the same hostname) is counted as internal.
- A non-internal skipped URL whose SiteOne reason is exactly `Not allowed host` is counted as an intentional external-host skip.
- Any remaining skipped URL is counted as other.

The original SiteOne observation remains unchanged:

- `sourceStatus` is preserved, including `CRITICAL`;
- `message` is preserved;
- raw SiteOne evidence remains in the workflow artifact.

The normalized facts provide context; they do not override SiteOne or establish an LDW quality gate.

## Summary behavior

The concise summary continues to report source-status counts.

When all skipped URLs are external `Not allowed host` rows and there are no internal/other skipped URLs, the summary adds explicit context that they were intentionally skipped by the same-host crawl policy.

When the skipped set is mixed, the summary reports the four counts and does not describe the whole set as intentional external skipping.

## Failure semantics

If SiteOne emits the `skipped` summary observation but the required structured `tables.skipped.rows` evidence is missing or malformed, normalization fails closed. It never falls back to parsing the human-readable summary message.

## Compatibility

Consumers that only understand earlier minor versions may ignore these additive facts.

Consumers that rely on skipped-URL context should require:

`schemaMinorVersion >= 3`

The major contract remains `ldw.website-quality.v1`.

Historical minor-1 and minor-2 artifacts are not rewritten.
