# Website Quality Toolkit

Website Quality Toolkit (WQT) is Lowcountry Digital Works' **website-specific deterministic sensing and normalized-evidence layer**. It runs maintained scanners against an authorized website, preserves what those scanners actually observed, and produces a stable machine contract for downstream use.

WQT is service-enabling infrastructure. It is **not** a customer-facing SaaS product, an SEO strategy engine, or an LDW quality-scoring system.

## What WQT does today

An authorized WQT run uses two pinned source tools:

- **SiteOne Crawler 2.5.1** — whole-site same-authority technical/site/SEO evidence, including crawlability, HTTP/status behavior, redirects, titles and metadata, headings, robots/canonical/indexability-related source observations, internal/external crawl behavior, caching/performance-oriented findings, selected security evidence, accessibility-oriented findings, and other scanner-native quality evidence.
- **Lighthouse 13.4.1** — a focused **homepage desktop lab audit** for performance, accessibility, best practices, and SEO.

The current effective scan profile is **`site_only`**:

- crawl the authorized site/origin under the accepted target boundary;
- discover external URLs;
- do **not** recursively crawl arbitrary third-party hosts;
- preserve external-host skips as source coverage/context;
- do not reinterpret an intentional external-host skip as an LDW site-failure verdict.

Future bounded scan-depth research such as explicitly authorized owned origins or one-hop external-link validation is tracked separately in [WQT-SCOPE-001 #23](https://github.com/LowcountryDigitalWorks/website-quality-toolkit/issues/23). WQT-UX-001 does not implement those profiles.

## What an operator gets

Operator surfaces for a successful run are:

| Path | Purpose |
| --- | --- |
| GitHub step summary (public workflow) / `summary.md` (accepted private-runtime shape after separately governed repin) | Bounded source-neutral operator landing page |
| `reports/siteone.html` | **SOURCE-NATIVE SITEONE REPORT — NOT LDW QUALITY POLICY** |
| `reports/lighthouse.html` | **SOURCE-NATIVE LIGHTHOUSE REPORT — NOT LDW QUALITY POLICY** |
| `raw/siteone.json` | SiteOne machine evidence |
| `raw/lighthouse.json` | Lighthouse machine evidence |
| `normalized/website-quality.json` | Stable `ldw.website-quality.v1` machine contract for downstream consumers |
| `external-links.json` | Stable `ldw.wqt-external-links.v1` machine sidecar for external link reachability evidence |

The HTML reports are scanner-native operator/remediation/debug surfaces. They are useful precisely because they can retain richer source detail than WQT intentionally normalizes. They are **not** canonical WQT semantics and must not be treated as LDW severity, policy, or a client-ready report.

The normalized contract remains the authoritative reusable WQT output for downstream systems.

## WQT, G.A.S., delivery automation, and project tests

The intended architecture is:

`authorized website -> WQT website sensors -> normalized WQT evidence -> private WQT operations/integrity/history -> G.A.S. -> separately governed delivery automation where required`

Responsibilities stay distinct:

| Layer | Primary job |
| --- | --- |
| **WQT** | What did the website-specific scanners observe, under what exact target/source/version/scope/provenance? |
| **G.A.S. (Generative / Answer / Search)** | Broader provider-neutral Search / SEO / GEO-AIO / AI-visibility intelligence over WQT plus replaceable sources: longitudinal comparison, search analytics, discovery/index evidence, technical SEO, AI visibility, later-justified rank/SERP/local/link evidence, human review/decision support, measurement/outcome, and operator/service reporting. |
| **Separately governed report/delivery automation** | Render and deliver approved client-facing material when that workflow is separately authorized. It does not replace G.A.S. analysis semantics. |
| **Website repositories** | Project-local browser regression, accessibility, integration, and application-specific tests where those belong with the site itself. |

WQT must not rebuild G.A.S., and G.A.S. must not rebuild WQT's crawler.

## Technical SEO boundary

WQT owns **website-specific sensing** for technical/site-quality and technical/on-site SEO evidence supported by the accepted scanners.

WQT itself does **not** own:

- keyword research;
- rank tracking;
- backlink intelligence;
- competitor SERP research;
- Search Console query/click/impression intelligence;
- generative/AI visibility measurement;
- prompt/citation visibility;
- content strategy;
- Google Business Profile/local rank intelligence; or
- longitudinal cross-source interpretation.

Those capabilities are not necessarily outside LDW or outside G.A.S. They belong in the broader G.A.S. Search / SEO / GEO-AIO / AI-visibility intelligence system through replaceable sensors/integrations when separately justified.

## Evidence policy

WQT is **evidence-first**:

- SiteOne `--ci` remains disabled so upstream default gates do not silently become LDW policy.
- SiteOne statuses/scores and Lighthouse scores remain **SOURCE-NATIVE** evidence.
- WQT does not invent a combined health score, LDW severity, automatic priority, ranking impact, causal explanation, business impact, or remediation recommendation.
- Tool/install/integrity/runtime/parsing failures may fail a run; scanner findings do not fail evidence collection merely because a source score/status looks unfavorable.
- Missing or unsupported evidence must not be converted into `healthy`, zero, or unchanged.

The compact operator summary deliberately shows source status/message/facts while remaining bounded. Richer page-level detail stays in the source-native HTML/raw evidence unless a real accepted downstream need later justifies a normalized contract change.

## Public and private execution

The public repository owns reusable scanner, resolver, normalization, summary, tests, and workflow behavior.

The public workflow keeps a fail-closed checked-in registry for the already-public Baseline 0.3 targets. There is no free-form URL input and no public generic scanner route. Pull requests validate the harness without scanning a live site; production evidence collection remains explicit `workflow_dispatch` only, with no recurring schedule.

`LowcountryDigitalWorks/wqt-operations` is now the accepted **private execution/evidence/history surface** for managed-site operation. It owns private target authority and private evidence operations while consuming an immutable accepted WQT ref. Public WQT changes do not automatically alter that private runtime; private ref changes remain separately reviewed and pinned.

See [`docs/WQT-OPS-001-PRIVATE-RUNTIME.md`](docs/WQT-OPS-001-PRIVATE-RUNTIME.md) for the trust boundary. Do not put customer/private registry data or customer evidence in this public repository.

## Known current limitations

- **Compression evidence — WQT-SEM-003 / #16:** pinned SiteOne 2.5.1 may emit a Brotli-support source warning, but current accepted evidence does not truthfully establish whether actual delivery used `zstd`, `br`, `gzip`, or none. Do not infer actual compression from that warning. The upstream-dependent work remains tracked in [issue #16](https://github.com/LowcountryDigitalWorks/website-quality-toolkit/issues/16).
- **Lighthouse scope:** the accepted lab audit is the homepage only. Representative-route or site-wide lab coverage remains future research and should not be added unless real managed-site evidence shows the current scope is insufficient.
- **External URLs:** under current `site_only` behavior, external URLs can be discovered but arbitrary third-party hosts are not recursively crawled. Deeper bounded profiles are research-only in [issue #23](https://github.com/LowcountryDigitalWorks/website-quality-toolkit/issues/23).
- **Normalized detail:** SiteOne raw/native reports can contain richer page-level remediation data than `ldw.website-quality.v1`; WQT intentionally does not normalize every source field merely because it exists.

## Evidence QA

Scanner-version and normalized-semantic changes must follow [`docs/EVIDENCE-QA.md`](docs/EVIDENCE-QA.md), including exact source provenance, authorized target/scope verification, raw-to-normalized reconciliation, source-status preservation, known source limitations, summary/report consistency, fail-closed missing evidence, and a separately authorized post-merge real proof when actual scan/report behavior changes.

## Accepted baseline history

The original baseline documents remain historical release evidence; they are not the best current-state product introduction:

- [`docs/BASELINE-0.1.md`](docs/BASELINE-0.1.md) — accepted initial reproducible evidence baseline.
- [`docs/BASELINE-0.2.md`](docs/BASELINE-0.2.md) — accepted controlled second-site validation.
- [`docs/BASELINE-0.3.md`](docs/BASELINE-0.3.md) — accepted public controlled-target-registry engine baseline.

Do not rewrite historical retention, target, or release facts in those documents into current private-runtime policy.

## Local validation

The repository pins Node `24.18.1` through `.nvmrc` and Lighthouse `13.4.1` through the lockfile.

On WSL/Linux, use Linux-native Node and npm. Confirm they resolve to Linux paths rather than Windows interoperability paths before installing dependencies.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
bash -n scripts/*.sh
node --check scripts/resolve-target.mjs
node --check scripts/resolve-private-target.mjs
node --check scripts/normalize.mjs
node --check scripts/write-summary.mjs
node --check scripts/probe-external-links.mjs
git diff --check
```

To verify the pinned SiteOne release artifact without scanning a site:

```bash
bash scripts/download-siteone.sh
```

Target resolution can be checked without network access. The public path is registry-backed by [`config/targets.json`](config/targets.json):

```bash
bash scripts/resolve-target.sh lowcountrydigitalworks
bash scripts/resolve-target.sh donovanfamilydentistry
```

Any blank, malformed, URL-shaped, unknown, disabled, duplicate, noncanonical, or unsafe target/registry input fails closed. Production scanner wrappers accept an authorized opaque `WQT_SITE_ID`; they do not accept a caller-supplied URL or registry path.

## Repository boundaries

WQT does not add, merely for convenience:

- a customer portal/dashboard or multi-tenant SaaS;
- a database or customer-state store;
- credentials, OAuth, provider API keys, or customer secrets;
- recurrence/scheduling in the public toolkit;
- runtime AI/LLM analysis;
- automatic issue creation or remediation;
- unrestricted external crawling;
- another crawler or duplicate scanner logic;
- GSC/GA/provider analytics clients;
- rank/backlink/keyword databases;
- customer-facing reporting/delivery behavior; or
- organization-wide GitHub governance/security automation.

Organization-wide GitHub workflow orchestration and common repository-security automation belong in [`LowcountryDigitalWorks/.github`](https://github.com/LowcountryDigitalWorks/.github).

Reusable website-quality capabilities should be added here only when real scan/consumer evidence justifies them and the result remains deterministic, portable, low-cost, and inside WQT's website-sensing boundary.
