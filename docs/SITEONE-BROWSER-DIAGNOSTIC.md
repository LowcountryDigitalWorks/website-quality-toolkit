# WQT SiteOne Chromium single-page diagnostic (manual only)

**Status:** a diagnostic, **not** an accepted website-quality collection, quality score, customer scan, scanner configuration change, or GAS evidence adapter. See WQT issues #60 and #61.

The accepted WQT scanner profile intentionally uses pinned SiteOne Crawler 2.5.1 in non-browser mode. The public LDW-owned baseline returned HTTP 403 and a Cloudflare challenge resource. The normalizer correctly rejects that blocked crawl rather than producing misleading healthy SiteOne scores. This one-shot diagnostic tests whether the pinned SiteOne browser mode observes a different response without changing Cloudflare protection.

## Execution and bounds

The separate manually dispatched GitHub Actions workflow is **siteone-browser-diagnostic.yml**. It has no push, PR, schedule, URL, customer-site, or arbitrary-flags input. It hardcodes the sole LDW-owned target **https://lowcountrydigitalworks.com/**. It:

- Runs only on manual workflow dispatch, never on pull requests.
- Uses the checksum-verified existing SiteOne 2.5.1 downloader and an already installed Chrome executable. It refuses missing browser/CLI capabilities.
- Uses single-page mode, one browser worker, one ordinary worker, one request per second, and fixed timeouts. No browser sandbox downgrade, browser auto-download, User-Agent spoofing, proxy, clearance tokens, challenge bypass, or ignore-robots option.
- Keeps scanner output and logs only in a temporary private runner directory, deleted after processing. Raw HTML, JSON and logs are **never uploaded** to the public GitHub artifact channel.
- Uploads at most one small allowlisted sanitized JSON diagnostic, retained seven days. The parser reads a maximum of two MiB and copies no raw headers, cookies, IPs, email addresses, HTML, body, or arbitrary source URLs.

The workflow itself must **not be dispatched** until the source has been independently reviewed, required checks pass, and the guarded PR is merged. Merging diagnostic source does not authorize changes to Cloudflare or production WQT scanning.

## Evidence interpretation

Output schema: **ldw.wqt-siteone-browser-diagnostic.v1**. Evidence-only is always true; pageContentVerified is **always false**. Classification is deliberately conservative:

| Coverage | Meaning |
| --- | --- |
| blocked_or_http_error | Exact configured homepage returned HTTP 4xx/5xx. SiteOne coverage was unsuccessful. |
| http_200_challenge_resource_seen | Homepage returned HTTP 200 but a challenge resource appeared too. No claim of clearance. |
| http_200_content_unverified | Homepage returned HTTP 200 and no challenge resource was observed. Actual homepage HTML is still unverified. |
| non_200_content_unverified | Non-200, non-error status. Actual content remains unverified. |
| unknown | Missing source, exact root, or trustworthy HTTP status; neither healthy nor failed is proven. |

challengeResourceObserved=false means not observed, never a proved absence. Scanner exit code 0 proves process completion only. An actual scanner-method upgrade requires a separately accepted genuine-homepage-content proof, methodology/version review, quality-contract impact assessment, and a new source authorization. The diagnostic artifact is **not** WQT's normalized SiteOne/Lighthouse evidence, and must not be injected as such.

No Cloudflare Bot Fight Mode/WAF, DNS, mail, credentials, production settings, standard WQT scanner, or GAS release are changed. An unsuccessful diagnostic is useful evidence, **not** authority to weaken Cloudflare. Rollback: leave the separate manual workflow undispatched or disable it; existing scanner behavior remains unchanged.

**Sandbox provenance:** The collection-method string records that the workflow does not request a sandbox-disable override; it is **not** a measurement or attestation that Chrome's sandbox remained active on the runner. If Chrome cannot run under unchanged isolation, the diagnostic should fail or remain unknown, not add a bypass flag.

**Execution gate:** A future manually dispatched workflow still makes a real public-site request. This repository change includes only diagnostic plumbing; source acceptance and merge do not by themselves authorize a live dispatch, a recurring scan, or any Cloudflare change. The separate authorized one-off runtime check and evidence review are required before interpreting any result.
