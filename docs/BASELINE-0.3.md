# Baseline 0.3 — Controlled Target Registry

Baseline 0.3 exists to move the fail-closed execution allowlist from hard-coded
shell logic and a static GitHub Actions `choice` list into a single reviewable
configuration file, without expanding the toolkit into a generic scanner,
adding persistent infrastructure, or coupling it to any external automation
platform.

The purpose is **allowlist maintainability**, not target expansion. Baseline
0.3 authorizes the same two sites as Baseline 0.2.

## Controlled target registry

`config/targets.json` is the single source of truth for authorized scan
targets:

```json
{
  "schemaVersion": "ldw.website-quality-targets.v1",
  "targets": [
    { "id": "lowcountrydigitalworks", "url": "https://lowcountrydigitalworks.com", "enabled": true },
    { "id": "donovanfamilydentistry", "url": "https://donovanfamilydentistry.com", "enabled": true }
  ]
}
```

`scripts/resolve-target.mjs` loads and validates this file, and
`scripts/resolve-target.sh` remains the thin, previously-existing bash
entry point used by both scanner wrappers and local validation.

## Fail-closed validation rules

Resolution fails closed — before either scanner executes — for:

1. a blank, malformed (leading/trailing whitespace), or URL-shaped site
   identifier;
2. an unknown site identifier (not present in the registry);
3. a **disabled** target (`enabled: false`);
4. a registry that is missing, not valid JSON, or has an unrecognized
   `schemaVersion`;
5. a registry containing a **duplicate** `id`;
6. a registry entry whose `url` is **unsafe or malformed**: not `https://`,
   containing userinfo, a path/query/fragment, an IP-literal or `localhost`
   host, or otherwise not a bare HTTPS origin.

Registry integrity (duplicate IDs, schema shape, per-entry URL safety) is
validated in full before any lookup is attempted, so a corrupted or tampered
registry fails closed regardless of which site identifier was requested.

There is still no free-form URL workflow input and no route to arbitrary
public URL scanning. `scripts/resolve-target.mjs` accepts an optional
registry path override for tests only; the production entry point and the
GitHub Actions workflow always resolve against `config/targets.json`.

## Workflow input change

The `workflow_dispatch` `site` input changes from a static `choice` (which
required editing the workflow YAML to add or remove an authorized site) to a
plain `string` input:

```yaml
inputs:
  site:
    description: Authorized site identifier (validated against config/targets.json)
    required: true
    default: lowcountrydigitalworks
    type: string
```

This is still **not** a free-form URL field. The value is an opaque site
identifier that must resolve through the fail-closed registry lookup above
before any scanner runs; typing an arbitrary string, a disabled ID, or a URL
simply fails the run before evidence collection starts. Adding, removing, or
disabling an authorized site is now a `config/targets.json` change (reviewed
like any other code change) rather than a workflow-YAML edit.

## Evidence changes

### `siteId` in normalized evidence

The resolved site identifier is now recorded alongside the resolved origin in
normalized evidence:

```json
{
  "schemaVersion": "ldw.website-quality.v1",
  "schemaMinorVersion": 1,
  "siteId": "lowcountrydigitalworks",
  "target": "https://lowcountrydigitalworks.com",
  "...": "..."
}
```

`scripts/normalize.mjs` requires a non-empty `--site-id` and rejects a
missing/blank value. The normalizer stays target- and registry-neutral: it
validates that `siteId` is present and well-formed, but does not itself read
`config/targets.json` or re-implement allowlist logic.

### Evidence schema minor-version decision

This is the accepted WQT workstream decision for evolving the normalized
evidence shape without breaking existing consumers:

- `schemaVersion` (`ldw.website-quality.v1`) identifies the **major**,
  potentially-breaking evidence shape. It changes only when an existing field
  is removed, renamed, or given new meaning.
- `schemaMinorVersion` (a plain integer, starting at `1` for Baseline 0.3) is
  a **separate, purely additive** counter. It increments when a new field is
  added without changing or removing anything existing.
- Consumers that do not recognize `schemaMinorVersion` can safely ignore it —
  it is additive metadata, not a compatibility gate.
- Consumers that depend on a field introduced in a later minor version should
  check `schemaMinorVersion` numerically (e.g. `>= 1` for `siteId`) rather
  than parsing `schemaVersion` as a compound version string.
- A future breaking change must bump `schemaVersion` (e.g. to `.v2`) and is
  not represented by the minor counter.

`scripts/write-summary.mjs` continues to gate only on the major
`schemaVersion` string, so it remains forward-compatible with future
additive minor versions.

## What Baseline 0.3 does not change

Baseline 0.3 preserves every Baseline 0.2 boundary:

- the same two authorized sites, both `enabled: true`;
- no recurring `schedule` trigger;
- `pull_request` runs remain validation-only; the `scan` job still only runs
  for non-`pull_request` events and never scans a live site during PR
  validation;
- workflow permissions remain `contents: read`, and both checkout steps keep
  `persist-credentials: false`;
- no free-form URL input anywhere in the workflow or scripts;
- no Activepieces, SuiteDash, or other external automation-platform coupling;
- no database, dashboard, or persistent service — evidence remains temporary
  GitHub Actions artifact data with 30-day retention;
- SiteOne, Lighthouse, Node, and first-party Action pins are unchanged, and
  `package.json`/`package-lock.json` dependency content is unchanged;
- no production scan is performed by this change; publishing/merging this
  baseline does not itself execute `workflow_dispatch`.

## Deterministic allowlist validation

Pull-request validation includes no-network tests proving:

1. both authorized identifiers still resolve to their exact authorized
   origins;
2. blank, malformed, URL-shaped, and unknown identifiers are rejected;
3. a disabled registry entry is rejected even when otherwise well-formed;
4. a duplicate `id` in the registry is rejected;
5. a registry that is missing, not valid JSON, or has the wrong
   `schemaVersion` is rejected;
6. an unsafe registry entry URL (non-HTTPS, userinfo, path/query/fragment,
   IP-literal, or `localhost`) is rejected.

These tests invoke only the local resolver against the real registry and
disposable fixture/temporary registries; none contact either production
website.

## Public-artifact governance note

`config/targets.json`, the workflow YAML, and all scripts in this repository
are public artifacts in a public GitHub repository. No credential, customer
record, or private endpoint is introduced by the registry; it lists only the
same two already-public authorized origins from Baseline 0.2. Any future
addition to the registry is a normal, publicly-reviewable pull request against
this file, not a hidden or privately-configured allowlist.

## Expected recurring cost

Expected new recurring infrastructure cost remains **$0**. Baseline 0.3 adds
one static JSON configuration file and refactors existing shell/Node logic
already running on the existing public GitHub repository and GitHub-hosted
Actions. No paid SaaS, persistent compute, or new external service is
introduced.
