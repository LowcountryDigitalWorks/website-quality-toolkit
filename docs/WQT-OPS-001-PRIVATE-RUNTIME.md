# WQT-OPS-001 — Private Managed-Target Runtime Boundary

## Purpose

This document defines the reusable public-repository boundary for WQT-OPS-001. It allows a trusted private or customer-owned runtime to resolve an authorized private target and then reuse the same SiteOne/Lighthouse execution implementation as the public workflow without adding customer configuration or evidence to public WQT.

This is an implementation boundary only. It does not authorize customer enrollment, private production deployment, recurring scan activation, or any SuiteDash/Activepieces mutation.

## Authority split

Public WQT keeps the accepted Baseline 0.3 authority model:

`opaque WQT_SITE_ID -> scripts/resolve-target.sh -> config/targets.json -> validated canonical origin -> shared scanner core`

The checked-in public registry remains limited to the two already-disclosed targets. The public workflow has no direct URL input, no private-registry path input, no secret-based registry injection, and no recurring schedule.

A future trusted private/customer-owned wrapper may instead use:

`private registry path + opaque Site ID -> scripts/resolve-private-target.mjs -> validated canonical origin -> shared scanner core`

The private path changes only where the registry is supplied. It does not create a second validation contract.

## Private registry contract

Private runtimes must use the existing `ldw.wqt-target-registry.v1` schema. The closed registry and site-entry field sets, opaque Site-ID syntax, `production` environment requirement, canonical HTTPS-origin checks, duplicate checks, enabled-state check, and fail-closed behavior remain implemented only in `scripts/resolve-target.mjs`.

Do not add customer/service metadata, contacts, repository references, authorization prose, scanner flags, vendor identifiers, credentials, or secrets to this registry.

## Trusted resolver

The private resolver entrypoint is:

```text
node scripts/resolve-private-target.mjs <registry-path> <site-id>
```

It requires exactly those two arguments and delegates resolution to `resolveTarget(siteId, registryPath)`. It never accepts a direct target URL as authority. A URL-shaped Site ID therefore fails under the existing opaque-ID contract.

On success, stdout contains only the validated origin plus a newline. On failure, the resolver returns nonzero and emits a deliberately generic diagnostic so private registry contents, unrelated entries, origins, or metadata are not echoed to logs.

The registry path is runtime configuration, not a credential. The registry contents may still be confidential and must remain in the approved private/customer-owned runtime.

## Shared scanner execution boundary

`scripts/scanner-core.sh` is a library-only shell module. It contains the single SiteOne and Lighthouse command implementations and may receive an already-validated origin internally from an authorized wrapper.

Direct execution of `scanner-core.sh` fails. It is not a generic URL-scanner CLI and it performs no target authorization itself.

The public wrappers remain responsible for public authority:

- `scripts/run-siteone.sh`
- `scripts/run-lighthouse.sh`

Both continue to resolve `WQT_SITE_ID` through `scripts/resolve-target.sh` before calling the shared scanner function. Their positional argument remains the output path, not a URL.

The shared core preserves the existing scanner semantics, including the pinned SiteOne artifact/version outside this module, Lighthouse `13.4.1` from the unchanged package lock, current Chrome/Chromium discovery, SiteOne throttling/output flags, Lighthouse desktop/category/output flags, and evidence-first behavior. It does not add SiteOne `--ci`, browser, AI, upload, or new runtime flags.

## Future private/customer-owned wrapper

A separately authorized private runtime should:

1. Check out an immutable accepted WQT commit/ref.
2. Install the exact locked Node dependencies.
3. Verify/download the pinned SiteOne artifact.
4. Provide the private `ldw.wqt-target-registry.v1` file from the approved private/customer-owned surface.
5. Resolve the opaque Site ID with `scripts/resolve-private-target.mjs`.
6. Source `scripts/scanner-core.sh` and invoke the appropriate scanner functions with the validated origin.
7. Normalize evidence with the same validated Site ID and origin using the accepted WQT normalizer.
8. Retain raw and normalized customer evidence only in the approved private/customer-owned surface.
9. Hand normalized evidence only to an approved downstream consumer.

A private wrapper must not reimplement or weaken WQT target validation or scanner command semantics.

## Evidence and privacy

Public WQT remains reusable public-safe code and synthetic/public evidence infrastructure. Real customer target registries, raw scan evidence, normalized customer evidence, credentials, tokens, private keys, PHI/CUI, payment data, and other customer secrets do not belong in this repository or its public Actions artifacts.

Recurring monthly, post-release, or exception/re-verification execution belongs to the external private/customer-owned orchestrator. Public WQT remains unscheduled.

## Cost and operating posture

This boundary introduces no new dependency, SaaS, database, runtime AI, paid runner requirement, or recurring cash cost. The target incremental recurring cash cost is `$0`. Included/free private GitHub capacity may be suitable for a bounded pilot, but it is not a permanent SLA guarantee.

## Relationship to managed-site operations

This boundary is the reusable WQT prerequisite for the managed-site coordination tracked in `LowcountryDigitalWorks/business-operations#176`. WQT-OPS-001 does not itself enroll a customer or activate recurring production execution. Those remain separately gated decisions after this code is independently reviewed and accepted.
