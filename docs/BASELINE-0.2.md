# Baseline 0.2 — Controlled Second-Site Validation

Baseline 0.2 exists to test whether the accepted Baseline 0.1 website-quality evidence architecture is portable to one second explicitly authorized maintained website without turning the toolkit into a generic scanner or a multi-tenant service.

The purpose is **controlled second-site portability validation**, not product expansion.

## Exact execution allowlist

Production evidence collection is fail-closed to exactly these site identifiers and HTTPS origins:

| Site identifier | Exact target |
| --- | --- |
| `lowcountrydigitalworks` | `https://lowcountrydigitalworks.com` |
| `donovanfamilydentistry` | `https://donovanfamilydentistry.com` |

`scripts/resolve-target.sh` is the shared target authority for scanner execution. Blank, malformed, URL-shaped, unknown, and future identifiers fail before either scanner executes.

There is no free-form URL workflow input and no route to arbitrary public URL scanning.

## Architecture

Baseline 0.2 preserves the accepted Baseline 0.1 evidence architecture:

- **SiteOne Crawler** `2.5.1` for whole-site evidence;
- **Lighthouse CLI** `13.4.1` for focused homepage lab evidence;
- **GitHub Actions** for pull-request validation, explicit manual production evidence collection, job summaries, and temporary artifacts;
- **LDW normalizer** using the unchanged `ldw.website-quality.v1` schema as a thin evidence-preservation layer.

The normalizer remains target-neutral. Baseline 0.2 does not redesign it, add scanner logic, or add tenant/customer configuration.

## Workflow behavior

The workflow keeps two triggers:

- `pull_request`: validation only; the scan job is disabled and neither production site is scanned;
- `workflow_dispatch`: production evidence collection using a `choice` input containing only the two authorized site identifiers.

`lowcountrydigitalworks` is the default manual choice.

There is **no recurring schedule**.

The artifact name safely includes the selected allowlisted site identifier and GitHub run ID. Evidence remains temporary GitHub Actions artifact data with 30-day retention.

Workflow permissions remain:

`contents: read`

Both checkout steps continue to use:

`persist-credentials: false`

No secrets or provider credentials are required.

## Evidence-only policy

Baseline 0.2 establishes no LDW quality thresholds.

- SiteOne `--ci` remains disabled.
- SiteOne browser mode is not enabled.
- SiteOne AI options are not enabled.
- SiteOne upload is not enabled.
- Existing worker and request-rate limits are preserved.
- Lighthouse and SiteOne findings/scores remain source evidence rather than pass/fail policy.
- Installation, integrity, scanner execution, parsing, and normalization failures may still fail a workflow run.

## Deterministic allowlist validation

Pull-request validation includes no-network tests proving:

1. `lowcountrydigitalworks` resolves exactly to `https://lowcountrydigitalworks.com`;
2. `donovanfamilydentistry` resolves exactly to `https://donovanfamilydentistry.com`;
3. blank, malformed, URL-shaped, unauthorized, and future identifiers are rejected with a non-zero status before scanner execution.

These tests invoke only the local resolver and do not contact either production website.

## Explicit exclusions

Baseline 0.2 does **not** add or authorize:

- quality thresholds or SiteOne `--ci`;
- a recurring schedule;
- multi-tenancy;
- a generic public scanner;
- free-form target URLs;
- any additional scanner;
- OWASP ZAP or other active DAST;
- Search Console, Bing, Cloudflare, or other provider APIs;
- provider/customer credentials;
- customer records or PHI;
- a database or dashboard;
- persistent hosted reporting infrastructure;
- automatic issue creation;
- AI/LLM analysis;
- Activepieces;
- tenant/customer configuration;
- customer-facing product functionality.

Browser regression and detailed accessibility testing remain project-local where the maintained website already owns those controls.

## Dependency and supply-chain boundary

Baseline 0.2 does not upgrade or replace any accepted dependency or tool pin:

- SiteOne remains `2.5.1` with the same release asset and SHA-256 verification;
- Lighthouse remains exact-pinned at `13.4.1`;
- Node remains `24.18.1`;
- `package.json` and `package-lock.json` dependency content remain unchanged;
- first-party GitHub Actions remain pinned to the same immutable commit SHAs.

## Expected recurring cost

Expected new recurring infrastructure cost remains **$0**.

No paid SaaS or persistent cloud resource is introduced. The validation uses the existing public GitHub repository and GitHub-hosted Actions with temporary artifacts only. Future GitHub usage or billing-policy changes would require reevaluation if they create material cost.

## Post-merge Donovan validation

After independent review and merge, the Website Quality Toolkit Orchestrator is authorized to perform exactly **one** production `workflow_dispatch` selecting:

`donovanfamilydentistry`

Before consuming that run, the orchestrator must independently verify current WQT `main`, current Donovan repository/site state, and basic production reachability.

No other production scan is authorized by Baseline 0.2.

The Donovan run must preserve the same evidence classes used in Baseline 0.1: raw SiteOne JSON, raw Lighthouse JSON, normalized LDW JSON, Actions summary/artifact metadata, runtime/practicality, finding classification, overlap/noise assessment, and privacy/network observations.

## Final evaluation gate

The controlled second-site validation will return one of these outcomes based on **distinct value versus Donovan's existing project-local CI**:

- **A — distinct reusable value demonstrated:** retain the two-site evidence architecture as a useful maintenance capability and return evidence for the next portfolio decision;
- **B — materially duplicative:** keep only the portions that add distinct value and do not expand the toolkit merely to duplicate strong website-local CI;
- **C — insufficient or problematic:** stop expansion and correct or retire the second-site path if portability, evidence quality, noise, privacy, reliability, or maintenance burden does not justify it.

This A/B/C evaluation is not a scanner score threshold. It is an architecture/service-value decision based on the controlled Donovan evidence return.
