# Website Quality Toolkit

`LowcountryDigitalWorks/website-quality-toolkit` is the home for reusable **website-specific** quality tooling used by Lowcountry Digital Works (LDW) and, where appropriate, future client website projects.

This repository is service-enabling infrastructure, not an authorized standalone SaaS product or a claim that every intended capability is implemented.

## Baseline 0.1

The current authorized implementation is **Baseline 0.1 — Reproducible Website Quality Evidence**.

It is intentionally narrow:

- target: `https://lowcountrydigitalworks.com` only;
- SiteOne Crawler `2.5.1` for whole-site evidence;
- Lighthouse `13.4.1` for focused homepage lab evidence;
- GitHub Actions for cloud execution, summaries, and temporary artifacts;
- a thin versioned LDW JSON normalizer that preserves source evidence without implementing scanner logic.

The detailed architecture, provenance, supply-chain controls, execution behavior, privacy boundary, exclusions, and post-merge run plan are documented in [`docs/BASELINE-0.1.md`](docs/BASELINE-0.1.md).

### Evidence-first behavior

Baseline 0.1 does **not** establish quality thresholds.

SiteOne `--ci` mode is deliberately disabled so its built-in default gates do not become LDW policy accidentally. Lighthouse and SiteOne findings/scores are retained as scanner evidence. Actual tool/install/integrity/runtime/parsing failures may fail the workflow, but a scanner score or finding does not fail the evidence-establishing scan merely for crossing an invented threshold.

Pull requests validate the harness without scanning the production website. After merge, only manual dispatch is enabled for the one authorized controlled public-site evidence collection run.

## Intended scope

As tools are evaluated, adopted, and validated, this repository may provide reusable website-quality capabilities such as:

- SEO validation and crawling;
- metadata and structured website checks;
- broken-link validation;
- accessibility-oriented website checks;
- web performance and budget validation;
- static-site and browser-level website QA;
- other deterministic website-quality checks; and
- web-specific security or DAST profiles where they logically belong.

The dedicated LDW SEO / website-quality workstream remains authoritative for this repository's technical architecture, tool selection, and implementation roadmap.

## Project-local browser and accessibility boundary

Website-specific browser regression and detailed accessibility tests remain with each website repository when that project already owns them. For `LowcountryDigitalWorks/lowcountrydigitalworks.com`, Playwright and `@axe-core/playwright` remain project-local and are not duplicated here.

## Boundaries

This repository does **not** own:

- organization-wide GitHub governance;
- generic GitHub Actions security policy;
- general secret scanning across all repositories;
- generic dependency-vulnerability scanning across all repositories;
- generic SBOM generation;
- generic repository SAST;
- organization-wide workflow-security automation; or
- unrelated application build and test pipelines.

Organization-wide GitHub workflow orchestration and common repository-security automation belong in [`LowcountryDigitalWorks/.github`](https://github.com/LowcountryDigitalWorks/.github).

Baseline 0.1 also does not add paid SaaS, persistent infrastructure, a database/dashboard, customer credentials/data, Google/Bing/Cloudflare provider APIs, Activepieces, Pa11y, Linkinator, OWASP ZAP, active DAST, OCR, AI/LLM analysis, automatic issue creation, multi-tenancy, or customer-facing product functionality.

## Local validation

With Node `24.18.1`:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
bash -n scripts/*.sh
```

To verify the pinned SiteOne release artifact without scanning a site:

```bash
bash scripts/download-siteone.sh
```

The production scan wrappers are intentionally hard-limited to `https://lowcountrydigitalworks.com` for Baseline 0.1.

Website-specific capabilities should be added here only when they provide reusable value and fit the LDW preference for deterministic, low-cost, portable, automation-first tooling.
