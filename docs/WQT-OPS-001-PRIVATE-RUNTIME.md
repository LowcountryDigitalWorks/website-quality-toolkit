# WQT-OPS-001 — Trusted Private Runtime Boundary

WQT-OPS-001 defines how the public Website Quality Toolkit (WQT) can be consumed by a trusted private runtime without turning the public repository into an arbitrary-URL scanner or customer-state store.

## Current operating model

The accepted current shape is:

`private authorized site profile -> private target registry -> immutable accepted WQT ref -> shared fail-closed resolver/scanner semantics -> private raw + normalized evidence -> private integrity/history -> G.A.S. and other separately approved downstream consumers`

`LowcountryDigitalWorks/wqt-operations` is the accepted **private execution/evidence/history surface** for managed-site operation and the shared LDW-managed default deployment tier under accepted WQT-OPS-002 policy. It is no longer merely a hypothetical future wrapper.

The public `LowcountryDigitalWorks/website-quality-toolkit` repository remains reusable scanner, normalization, summary, and contract code. Real customer target authority and real customer evidence remain outside this public repository.

Private runtime ref changes are separately governed. A merge to public WQT does not automatically change the private runtime: `wqt-operations` continues to pin an exact accepted WQT commit/tree until a later bounded repin is reviewed and accepted. Availability of new capabilities in public WQT (such as guarded external-link reachability) does not imply private runtime adoption or customer execution until a private repin and adoption gate occurs.

Scan and semantic evidence execution remains manual/point-in-time unless a service-specific cadence gate is separately authorized and accepted. Enrollment in Web Care or managed-site operation does not automatically activate scheduled or recurring scanning; private recurrence is currently OFF in the shared runtime.

## Authority boundary

The target-registry contract remains:

`ldw.wqt-target-registry.v1`

The closed entry shape remains exactly:

- `id`
- `origin`
- `environment`
- `enabled`

The existing `resolveTarget(siteIdentifier, registryPath)` implementation performs exhaustive validation for both public and trusted private callers.

### Public path

The public path remains:

`workflow_dispatch.site -> scripts/resolve-target.sh -> checked-in config/targets.json -> validated origin -> shared scanner core`

Public invariants:

- no URL workflow input;
- no registry-path workflow input;
- no recurring schedule;
- pull requests run validation only and do not scan a live site;
- workflow permissions remain `contents: read`;
- checkout credentials remain non-persistent;
- public target state is limited to explicitly public, reviewed registry entries;
- no customer/private evidence is introduced into the public repository.

### Trusted private resolver

The private resolver entrypoint remains:

`node scripts/resolve-private-target.mjs <registry-path> <site-id>`

It:

- requires exactly two arguments;
- accepts an explicit trusted registry file path plus opaque Site ID;
- calls the same `resolveTarget(siteId, registryPath)` validation implementation;
- never accepts a direct URL as authorization;
- fails closed for missing, malformed, unknown, disabled, duplicate, unsafe, noncanonical, or unexpected registry data;
- prints only the resolved canonical origin on success;
- does not print registry contents.

The public GitHub Actions workflow does not expose this private registry path.

## Scanner execution boundary

SiteOne and Lighthouse execution are centralized in:

`scripts/scanner-core.sh`

The core is library-only:

- direct execution fails;
- it does not resolve target authority;
- it does not read `WQT_SITE_ID`;
- it does not read a target registry;
- it accepts only an already-validated origin internally;
- SiteOne/Lighthouse flags and output behavior have one source of truth.

The public wrappers remain:

- `scripts/run-siteone.sh`
- `scripts/run-lighthouse.sh`

They resolve public `WQT_SITE_ID` authority before calling the shared core. The accepted private runtime resolves private authority first and then calls the same shared core from its pinned immutable WQT checkout.

## Evidence and presentation boundary

The canonical reusable machine layers remain:

- raw SiteOne JSON;
- raw Lighthouse JSON;
- normalized `ldw.website-quality.v1` evidence.

The WQT operator summary is a bounded source-neutral index over normalized evidence. Source-native SiteOne/Lighthouse HTML reports are presentation/debug/remediation artifacts, not canonical WQT semantic contracts and not LDW quality policy.

When a private runtime is separately repinned to a WQT ref that produces native HTML reports, the shared scanner core places them under the same site-scoped artifact root in `reports/`. The private runtime may upload those files as noncanonical presentation artifacts without changing target authority or normalized semantics. Private manifests/downstream semantic consumers remain authoritative only for the machine evidence they explicitly bind.

## Current downstream relationship

WQT and the private runtime answer primarily:

> What did the website-specific scanners observe, under what exact target/source/version/scope/provenance?

G.A.S. (Generative / Answer / Search) remains the broader provider-neutral Search / SEO / GEO-AIO / AI-visibility intelligence and decision-support engine. It may consume WQT plus other replaceable sources for compatible history/comparison, human review, measurement/outcome, and service-report composition. It must not rebuild WQT's crawler.

Separately governed report/delivery automation may render approved client-facing material later; it does not replace WQT evidence or G.A.S. analysis semantics.

## Private runtime responsibilities

The accepted private surface owns, subject to its own Product/Portfolio gates:

- private opaque target authority;
- execution against an immutable accepted WQT ref (public WQT capability additions do not automatically alter or execute in the private runtime);
- private raw/normalized evidence storage within the approved artifact boundary;
- integrity/provenance checks;
- private semantic history/consumer behavior where separately accepted;
- retention and manual/point-in-time execution policies; private recurrence remains OFF by default and requires explicit service-specific cadence authorization.

This public document intentionally does **not** contain private registry contents, customer identities, customer evidence, credentials, or private operational records.

## Explicit non-goals

This boundary does not authorize or add:

- customer/private target or evidence disclosure in the public repository;
- a public arbitrary-URL scanner;
- a public registry-path workflow input;
- a public recurring schedule;
- automatic recurrence activation merely from managed-site or Web Care enrollment;
- credentials, secrets, OAuth, or API keys;
- a database, dashboard, portal, or SaaS;
- automatic remediation;
- unrestricted external crawling;
- G.A.S. implementation inside WQT;
- normalized-evidence semantic expansion merely for presentation.

## Cost and ownership

Incremental recurring infrastructure cost target remains **$0**.

Under accepted WQT-OPS-002 policy, the shared LDW-managed private runtime (`LowcountryDigitalWorks/wqt-operations`) is the accepted default deployment tier for current managed-site operation. Customer-owned or dedicated private runtime deployment remains an exception or contractual path when separately required by a customer agreement, not the default operating preference. Customer and private target/evidence state must always remain outside the public WQT repository.

## Validation expectations

Public-repository tests must continue proving:

- the public resolver remains fixed to `config/targets.json`;
- private registry resolution reuses the exact existing validation contract;
- malformed/unknown/disabled/duplicate/unsafe inputs fail closed;
- direct URLs used as Site IDs fail closed;
- scanner core refuses direct execution;
- SiteOne/Lighthouse commands are not duplicated between authority paths;
- the public workflow cannot receive or invoke the private registry path;
- pull requests perform no live scan;
- normalized evidence semantics remain unchanged;
- scanner-native presentation output does not become LDW policy or a second scanning pass.
