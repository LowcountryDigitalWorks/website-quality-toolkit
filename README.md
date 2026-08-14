# Website Quality Toolkit

`LowcountryDigitalWorks/website-quality-toolkit` is the intended home for reusable **website-specific** quality tooling used by Lowcountry Digital Works (LDW) and, where appropriate, future client website projects.

The repository is currently a foundation, not a claim that the capabilities below are already implemented.

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

Website-specific capabilities should be added here only when they provide reusable value and fit the LDW preference for deterministic, low-cost, portable, automation-first tooling. This README intentionally does not choose or authorize specific scanners, services, or architecture beyond that boundary.
