# Baseline 0.3 — Controlled Target Registry

Baseline 0.3 exists to move the fail-closed execution allowlist from hard-coded
shell logic and a static GitHub Actions `choice` list into a single reviewable
configuration file, without expanding the toolkit into a generic scanner,
adding persistent infrastructure, or coupling it to any external automation
platform.

The purpose is **allowlist maintainability**, not target expansion. Baseline
0.3 authorizes the same two sites as Baseline 0.2, and — see the public-client
governance gate below — may not authorize a third.

## Controlled target registry

`config/targets.json` is the single source of truth for authorized scan
targets, using the accepted `ldw.wqt-target-registry.v1` contract:

```json
{
  "schemaVersion": "ldw.wqt-target-registry.v1",
  "sites": [
    { "id": "lowcountrydigitalworks", "origin": "https://lowcountrydigitalworks.com", "environment": "production", "enabled": true },
    { "id": "donovanfamilydentistry", "origin": "https://donovanfamilydentistry.com", "environment": "production", "enabled": true }
  ]
}
```

The root object accepts exactly `schemaVersion` and `sites` — no other
top-level field is authorized. Each entry in `sites` accepts exactly `id`,
`origin`, `environment`, and `enabled` — no other field is authorized. Both
field sets are closed (not merely validated when present) because this
registry is a public artifact: an unexpected field — a stray note, an API
key, a customer identifier, a scanner flag — must fail the whole registry
rather than be silently accepted. No scanner flags or other site-specific
settings are authorized in this file.

`scripts/resolve-target.mjs` loads and validates this file, and
`scripts/resolve-target.sh` remains the thin, previously-existing bash
entry point used by both scanner wrappers and local validation.

## Fail-closed validation rules

Resolution fails closed — before either scanner executes — for:

1. a blank, malformed, or URL-shaped site identifier, or one that does not
   match the accepted opaque-ID syntax `^[a-z0-9][a-z0-9-]{0,63}$`;
2. an unknown site identifier (not present in the registry);
3. a **disabled** target (`enabled: false`);
4. a registry that is missing, not valid JSON, has an unrecognized
   `schemaVersion`, or contains any unexpected root-level or site-entry field;
5. a registry containing a **duplicate `id`**;
6. a registry containing a **duplicate canonical origin** — two entries
   authorizing the same origin under different ids;
7. a registry entry whose `origin` is **unsafe or non-canonical**: not
   `https://`, containing userinfo, a path/query/fragment, an IP-literal or
   `localhost` host, or not byte-identical to `new URL(origin).origin`. That
   exact-equality requirement is what rejects alias forms of the same origin
   — a trailing slash (`https://example.com/`) or an explicit default port
   (`https://example.com:443`) — so exactly one canonical string authorizes
   each site;
8. an entry whose `environment` is missing or is not one of the explicitly
   authorized values (currently only `production`).

Registry integrity (duplicate ids, duplicate origins, schema shape, closed
field sets, per-entry origin canonicality, explicit environment) is validated
in full — for every entry — before any lookup is attempted, so a corrupted or
tampered registry fails closed regardless of which site identifier was
requested.

There is still no free-form URL workflow input and no route to arbitrary
public URL scanning. **The production CLI (`scripts/resolve-target.sh` /
`scripts/resolve-target.mjs` invoked directly) never accepts a
caller-controlled registry path** — not via an environment variable, a CLI
flag, a workflow input, or any other external invocation contract. It always
resolves against the checked-in `config/targets.json`. The machine-callable
contract is exactly:

```
site ID -> fixed repository registry -> validated exact canonical origin -> scan
```

Only the `resolveTarget`/`loadRegistry` functions accept an optional
`registryPath` argument, and only because unit tests import them directly and
pass disposable fixture/temporary registry paths; this parameter is not
exposed through any external interface.

## Workflow input change

The `workflow_dispatch` `site` input changes from a static `choice` (which
required editing the workflow YAML to add or remove an authorized site) to a
plain `string` input, **required, with no default**:

```yaml
inputs:
  site:
    description: Authorized site identifier (validated against config/targets.json)
    required: true
    type: string
```

There is intentionally no `default` value. Every human or machine dispatch
must explicitly name an approved site ID; an omitted value fails the run
instead of silently resolving to any particular site (e.g. LDW's own site).
The registry remains the authorization boundary, but omission must never
become an implicit production scan.

This is still **not** a free-form URL field. The value is an opaque site
identifier that must resolve through the fail-closed registry lookup above
before any scanner runs; typing an arbitrary string, a disabled ID, or a URL
simply fails the run before evidence collection starts. Adding, removing, or
disabling an authorized site is now a `config/targets.json` change (reviewed
like any other code change) rather than a workflow-YAML edit — subject to the
public-client governance gate below.

A dependency-free structural regression test (`test/workflow.test.mjs`)
mechanically proves the release invariants: a `pull_request` trigger exists;
no `schedule` trigger exists; the `scan` job is gated off for `pull_request`
events; `workflow_dispatch.inputs.site` is `required: true`, `type: string`,
and has no `default`; workflow permissions remain `contents: read`; every
`actions/checkout` step sets `persist-credentials: false`; and no
`${{ secrets.* }}` reference or `secrets:` block is present anywhere in the
workflow.

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

`scripts/normalize.mjs` requires `--site-id` and validates it against the
same opaque site-ID syntax used by the target registry
(`^[a-z0-9][a-z0-9-]{0,63}$`, exported as `SITE_ID_PATTERN` from
`scripts/resolve-target.mjs`) — not merely that it is non-blank. This keeps
normalized machine identity consistent with the target-registry contract.
Sharing the syntax pattern is not the same as reading the registry: the
normalizer imports only the regular expression, never `config/targets.json`
or any registry-loading/lookup logic, and stays target- and registry-neutral.

### Evidence schema minor-version decision (accepted)

This is the accepted WQT workstream decision for evolving the normalized
evidence shape without breaking existing consumers. The independent review
explicitly accepted this numeric model over an earlier proposed compound
version string (`ldw.website-quality.v1.1`):

- `schemaVersion` (`ldw.website-quality.v1`) identifies the **major**,
  potentially-breaking evidence shape. It changes only when an existing field
  is removed, renamed, or given new meaning.
- `schemaMinorVersion` (a plain integer, starting at `1` for Baseline 0.3,
  which introduces `siteId`) is a **separate, purely additive** counter. It
  increments when a new field is added without changing or removing anything
  existing.
- Consumers that do not recognize `schemaMinorVersion` can safely ignore it —
  it is additive metadata, not a compatibility gate. Unknown future additive
  minor versions may be tolerated.
- Consumers that depend on a field introduced in a later minor version should
  check `schemaMinorVersion` numerically (e.g. `>= 1` for `siteId`) rather
  than parsing `schemaVersion` as a compound version string.
- Removing, renaming, or reinterpreting an existing field requires a new
  major `schemaVersion` (e.g. `.v2`); it must never be represented by the
  minor counter.

`scripts/write-summary.mjs` continues to gate only on the major
`schemaVersion` string, so it remains forward-compatible with future
additive minor versions.

## What Baseline 0.3 does not change

Baseline 0.3 preserves every Baseline 0.2 boundary:

- the same two authorized sites, both `enabled: true`, both
  `environment: "production"`;
- no recurring `schedule` trigger (mechanically proven by
  `test/workflow.test.mjs`);
- `pull_request` runs remain validation-only; the `scan` job still only runs
  for non-`pull_request` events and never scans a live site during PR
  validation;
- workflow permissions remain `contents: read`, and both checkout steps keep
  `persist-credentials: false` (mechanically proven by
  `test/workflow.test.mjs`);
- no free-form URL input anywhere in the workflow or scripts;
- no Activepieces, SuiteDash, or other external automation-platform coupling;
- no database, dashboard, or persistent service — evidence remains temporary
  GitHub Actions artifact data with 30-day retention;
- SiteOne, Lighthouse, Node, and first-party Action pins are unchanged, and
  `package.json`/`package-lock.json` dependency content is unchanged;
- no production scan is performed by this change; publishing/merging this
  baseline does not itself execute `workflow_dispatch`.

## Public-client and evidence-governance gate

Baseline 0.3 may contain **only** the two targets already publicly disclosed
in Baseline 0.2: `lowcountrydigitalworks` and `donovanfamilydentistry`.

**No third or new client, and no third-party target, may be added to
`config/targets.json` (or any successor registry) until the WQT/SEO
workstream separately and explicitly resolves both:**

1. **target-registry confidentiality** — whether/how a client identifier and
   origin may be listed in this public repository at all; and
2. **raw/normalized scan-evidence confidentiality and storage** — where and
   how evidence for a non-LDW-owned site may be retained, given this
   repository currently only ever produces temporary, 30-day GitHub Actions
   artifacts with no persistent store.

Adding a registry entry is **not** merely an ordinary public pull request
once those two items exist as options — it is gated on the workstream
resolving them first. This baseline does not attempt to resolve either item
and does not create any storage infrastructure; it only documents that the
gate exists and must be resolved before scope expansion.

## Deterministic allowlist validation

Pull-request validation includes no-network tests proving:

1. both authorized identifiers still resolve to their exact authorized
   origins;
2. blank, malformed, URL-shaped, and unknown identifiers are rejected;
3. a disabled registry entry is rejected even when otherwise well-formed;
4. a duplicate `id` in the registry is rejected;
5. a duplicate **canonical origin** in the registry is rejected, even under
   distinct ids;
6. a registry that is missing, not valid JSON, has the wrong `schemaVersion`,
   or contains an unexpected root or site-entry field is rejected;
7. a non-canonical or unsafe registry entry origin (non-HTTPS, userinfo,
   path/query/fragment, trailing slash, explicit default port, IP-literal, or
   `localhost`) is rejected;
8. an entry with a missing or unauthorized `environment` value is rejected;
9. the production CLI ignores any `WQT_TARGET_REGISTRY` (or similar)
   environment override and always resolves against the checked-in registry;
10. `normalizeEvidence()` rejects a `siteId` that does not match the accepted
    opaque-ID syntax, not merely a blank one.

These tests invoke only the local resolver/normalizer against the real
registry and disposable fixture/temporary registries; none contact either
production website.

## Expected recurring cost

Expected new recurring infrastructure cost remains **$0**. Baseline 0.3 adds
one static JSON configuration file and refactors existing shell/Node logic
already running on the existing public GitHub repository and GitHub-hosted
Actions. No paid SaaS, persistent compute, or new external service is
introduced.
