# Baseline 0.1 — Reproducible Website Quality Evidence

Baseline 0.1 is the first bounded implementation of the Website Quality Toolkit. It exists to collect reproducible evidence from the public Lowcountry Digital Works website before LDW establishes any hard quality thresholds or broader managed-service architecture.

## Authorized target

Baseline 0.1 is hard-limited to:

`https://lowcountrydigitalworks.com`

The runner scripts reject any other target. No customer configuration, credentials, or private findings belong in this public repository.

## Architecture

The baseline composes maintained tools instead of implementing crawler/scanner logic:

- **SiteOne Crawler** for whole-site crawl, links, SEO, headers/security-quality, accessibility-oriented, and performance-oriented evidence;
- **Lighthouse CLI** for focused homepage lab evidence;
- **GitHub Actions** for pull-request validation, manual/scheduled execution, job summaries, and temporary artifact retention;
- **LDW normalizer** for a small versioned JSON representation of source evidence.

Browser regression and detailed accessibility checks remain project-local. For `lowcountrydigitalworks.com`, Playwright plus `@axe-core/playwright` remain owned by that website repository and are intentionally not duplicated here.

## Evidence-first policy

This release does **not** establish LDW quality gates.

- SiteOne `--ci` mode is intentionally not used because its built-in default score/count thresholds are not authorized LDW policy.
- Lighthouse category scores are preserved as lab evidence and do not fail the workflow for being low.
- SiteOne statuses and scores remain scanner-native evidence; the normalizer does not assign a new LDW severity.
- Actual installation, integrity, scanner execution, parsing, or normalization failures may fail the workflow.

The first controlled production-site run must be classified afterward as actionable, duplicate, informational, or noise/false-positive evidence before any future threshold is proposed.

## Tool provenance and pinning

### SiteOne Crawler

- Version: `2.5.1`
- Upstream: `janreges/siteone-crawler`
- License: MIT
- Release asset: `siteone-crawler-v2.5.1-linux-x64.tar.gz`
- Pinned SHA-256: `09278d958d4a087fa46093805cd33b085b96618001dd31d45c448ad724c9024e`

`download-siteone.sh` downloads only that versioned HTTPS release asset, validates its upstream-published SHA-256 before extraction or execution, installs the verified binary into the ignored local tools directory, and performs a bounded `--help` executable smoke check. The immutable release asset path plus verified digest establishes the exact artifact identity.

### Lighthouse

- Version: `13.4.1`
- Upstream: `GoogleChrome/lighthouse`
- License: Apache-2.0
- Distribution: npm dependency pinned exactly in `package.json`
- Integrity: npm lockfile v3 `resolved` and `integrity` metadata generated in GitHub-hosted CI and consumed with `npm ci --ignore-scripts`

### Node.js

- Version: `24.18.1`
- Pin: `.nvmrc`
- Package engine boundary: `>=24.18.1 <25`

### First-party GitHub Actions

Actions are pinned to immutable commit SHAs:

- `actions/checkout` v7.0.1: `3d3c42e5aac5ba805825da76410c181273ba90b1`
- `actions/setup-node` v6.4.0: `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`
- `actions/upload-artifact` v7.0.1: `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`

No third-party GitHub Action is required.

## Exact execution behavior

### SiteOne

The wrapper runs the verified SiteOne binary with the authorized target, JSON output, a small request rate, no persistent HTTP cache, and no HTML/text report generation.

It intentionally does **not** pass:

- `--ci`;
- `--browser`;
- any `--ai-*` option;
- `--upload`;
- SMTP/mail options.

The raw machine-readable result is written to `artifacts/raw/siteone.json`.

### Lighthouse

The wrapper uses the exact locked Lighthouse CLI against the homepage in desktop preset mode and requests the performance, accessibility, best-practices, and SEO categories. It uses Chrome/Chromium already available on the GitHub-hosted runner and does not provision a browser service.

The raw machine-readable result is written to `artifacts/raw/lighthouse.json`.

### Normalized evidence

`scripts/normalize.mjs` writes `artifacts/normalized/website-quality.json` with schema version:

`ldw.website-quality.v1`

The normalized document records source tool/version metadata, SiteOne source statuses/category scores, Lighthouse source category/audit values, and an explicit evidence-only gate policy. It does not reimplement scanner logic or manufacture an LDW severity.

## GitHub Actions behavior

Workflow permissions are:

`contents: read`

The workflow has three triggers:

- pull request: validation only; **no production website scan**;
- manual `workflow_dispatch`: validation followed by one scan;
- weekly schedule: Monday at `12:17 UTC`, validation followed by one scan.

The scan job uploads `artifacts/` for 30 days using the first-party upload-artifact action. This is temporary Actions artifact retention, not a persistent database or hosted report service.

## Network, privacy, and telemetry boundary

Expected network activity is limited to what the deterministic tools require:

- GitHub/npm dependency retrieval during setup;
- the pinned SiteOne release download from GitHub;
- DNS/TLS/HTTP activity required by SiteOne to inspect the authorized public website and its normal crawl evidence;
- Chrome/Lighthouse HTTP activity against the authorized public homepage.

Baseline 0.1 configures no Search Console, Bing, Cloudflare, Zoho, AI-provider, SMTP, customer, or production-write credentials. SiteOne upload and AI modes are not enabled. No Activepieces, OCR, LLM, database, dashboard, or persistent service is introduced.

Any unexpected outbound behavior observed in the controlled post-merge run must be reported before expanding the baseline.

## Expected recurring cost

Expected new recurring infrastructure cost: **$0**.

The implementation uses the existing public GitHub repository and GitHub-hosted Actions only. No paid SaaS or persistent cloud resource is introduced. Future usage/billing policy changes are outside this release and must be reevaluated if they would create cost.

## Deferred capabilities

Baseline 0.1 does not add Pa11y, Linkinator, OWASP ZAP, active DAST, Google Search Console API access, Bing API access, Cloudflare analytics integration, dashboards, databases, client configuration, multi-tenancy, automatic issue creation, AI/GEO scoring, or customer-facing product functionality.

## Post-merge controlled run

After independent review and merge:

1. manually dispatch one controlled scan against `https://lowcountrydigitalworks.com`;
2. preserve the raw SiteOne JSON, raw Lighthouse JSON, normalized LDW JSON, and Actions summary/artifact metadata;
3. record runtime and runner practicality;
4. classify findings as actionable, duplicate, informational, or noise/false positive;
5. compare overlap with project-local Playwright/axe and existing website CI;
6. note unexpected network/privacy/telemetry behavior, if any;
7. return the evidence to the Portfolio Orchestrator before proposing thresholds, new scanners, persistent storage, or a dashboard.
