# WQT-OPS-001 — Trusted Private Runtime Boundary

WQT-OPS-001 adds a bounded interface for trusted private/customer-owned execution without turning the public Website Quality Toolkit workflow into an arbitrary-URL scanner.

## Operating model

The accepted operating shape is:

`private authorized site profile -> private target registry -> immutable WQT ref -> shared fail-closed resolver/scanner semantics -> private raw + normalized evidence -> approved downstream consumer`

The public repository remains reusable scanner/normalization code. Real customer target authorization and real customer evidence belong in an approved private/customer-owned surface.

## Authority boundary

The registry contract remains:

`ldw.wqt-target-registry.v1`

The closed entry shape remains exactly:

- `id`
- `origin`
- `environment`
- `enabled`

The existing `resolveTarget(siteIdentifier, registryPath)` implementation continues to perform exhaustive validation for both public and trusted private callers.

### Public path

The public path remains unchanged:

`workflow_dispatch.site -> scripts/resolve-target.sh -> checked-in config/targets.json -> validated origin -> shared scanner core`

Public invariants:

- no URL workflow input;
- no registry-path workflow input;
- no schedule;
- pull requests run validation only;
- workflow permissions remain `contents: read`;
- checkout credentials remain non-persistent;
- public `config/targets.json` remains limited to the already-disclosed targets;
- public scan artifacts are only for the authorized public targets.

### Trusted private resolver

The private resolver entrypoint is:

`node scripts/resolve-private-target.mjs <registry-path> <site-id>`

It:

- requires exactly two arguments;
- accepts an explicit registry file path plus opaque Site ID;
- calls the same `resolveTarget(siteId, registryPath)` implementation used by tests/library callers;
- never accepts a direct URL as authorization;
- fails closed for missing, malformed, unknown, disabled, duplicate, unsafe, noncanonical, or unexpected registry data;
- prints only the resolved canonical origin to standard output on success;
- does not print registry contents.

This entrypoint is intended for a trusted private/customer-owned wrapper. It is not wired into the public GitHub Actions workflow.

## Scanner execution boundary

SiteOne and Lighthouse execution are centralized in:

`scripts/scanner-core.sh`

The core is library-only:

- direct execution fails;
- it does not resolve target authority;
- it does not read `WQT_SITE_ID`;
- it does not read a target registry;
- it accepts an already-validated origin internally;
- SiteOne/Lighthouse flags and output behavior have one source of truth.

The public wrappers remain:

- `scripts/run-siteone.sh`
- `scripts/run-lighthouse.sh`

They continue to resolve `WQT_SITE_ID` through the fixed public resolver before calling the shared scanner core.

A future private/customer-owned wrapper may:

1. checkout an immutable accepted WQT ref;
2. provide a private `ldw.wqt-target-registry.v1` file;
3. resolve an opaque Site ID with `resolve-private-target.mjs`;
4. source/use the shared scanner core with that validated origin;
5. normalize using the same WQT contract;
6. retain raw + normalized evidence only in the approved private/customer-owned surface.

## Explicit non-goals

This change does not authorize or add:

- real customer targets or evidence to the public repository;
- a private production wrapper deployment;
- customer production enrollment;
- a public arbitrary-URL scanner;
- a new public workflow input;
- a public recurring schedule;
- credentials, secrets, OAuth, or API keys;
- a database, dashboard, or new SaaS;
- new scanner/dependency versions;
- automatic remediation;
- normalized-evidence semantic changes.

## Cost and ownership

Incremental recurring infrastructure cost target remains **$0**.

Preferred production ownership remains customer-owned private execution with LDW scoped access. A bounded LDW-owned private pilot wrapper may be used only when separately authorized.

## Validation expectations

Public-repository tests must prove:

- the public resolver remains fixed to `config/targets.json`;
- private registry resolution reuses the exact existing validation contract;
- malformed/unknown/disabled/duplicate/unsafe inputs fail closed;
- direct URLs used as Site IDs fail closed;
- scanner core refuses direct execution;
- SiteOne/Lighthouse commands are not duplicated between authority paths;
- the public workflow cannot receive or invoke the private registry path;
- pull requests still perform no live scan;
- normalized evidence semantics remain unchanged.
