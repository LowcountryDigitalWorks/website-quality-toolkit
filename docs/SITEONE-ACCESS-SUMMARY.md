# SiteOne root-access operator note (diagnostic, not scanner evidence)

Status: source candidate under [WQT issue #67](https://github.com/LowcountryDigitalWorks/website-quality-toolkit/issues/67), not accepted until hosted CI, exact-head independent review and owning WQT release gates.

The existing public manual Website Quality Baseline scan attempts exactly the authorized target selected by WQT_SITE_ID. When the SiteOne raw result explicitly shows the configured root returned an HTTP 4xx/5xx, the accepted normalizer fails closed rather than publishing source-native quality scores measured from a block/challenge page.

The optional new GitHub Step Summary notice reads **only the SiteOne JSON from that same scan** after the normalization attempt, with an `always()` condition. It never performs a new request, retries a challenge, invokes a scanner, changes Cloudflare, runs during a pull request, or turns a failed job into success. Existing raw and Lighthouse evidence are retained by the existing final upload step.

## Fixed statuses

- `blocked_root_http_error`: Exact authorized origin/root explicitly returned a 4xx or 5xx. The source does not establish website quality or the cause of the denial.
- `http_200_challenge_resource_seen_content_unverified`: Root returned 200, but a challenge-platform resource URL was observed. Actual page content remains unverified.
- `http_200_content_unverified`: Root returned 200 without an observed challenge resource. That does **not** establish authentic page HTML or an unchallenged fetch.
- `redirect_unverified`: Exact root returned 3xx, without validating the eventual destination/content.
- `other_success_content_unverified`: Exact root returned 201–299 except 200; site content unverified.
- `unknown`: Missing/ambiguous root, malformed root HTTP status, or no structured results.
- `raw_unavailable`: Scanner produced no raw SiteOne file.

Challenge-resource `false` means **not observed**, never proved absent. Only exact registered origin and slash root are admitted; secondary assets, other schemes, query variants and third-party hosts cannot substitute. The note uses fixed wording, a validated opaque site ID, the explicit bounded HTTP status (or unknown), and a boolean only. It never prints source-native text, raw URLs, headers, cookies, contact data, scores, scanner command or full JSON into the public Step Summary.

## Contract and rollout

- No change to pinned SiteOne 2.5.1 or Lighthouse 13.4.1, site_only scan profile, normalizer, schema `ldw.website-quality.v1` minor 3, source status/gating, private WQT operations or G.A.S. adapter.
- No new jobs, permissions, secrets, schedules, URLs, network accesses, monitoring, paid providers or customer data.
- Added synthetic tests cover wrong/missing data, HTTP status families, actual-root identity, scanner version, duplicate roots, oversized/untrusted file, sanitized output and workflow no-PR-scan properties.
- Existing public artifact uploads still retain source-native and raw evidence; the diagnostic is Step Summary presentation only.
- After independent review and release, any private WQT operations adoption is a separate pinned-ref/provenance decision. This PR does not authorize a new live scan.

Blocked-root evidence under [issue #60](https://github.com/LowcountryDigitalWorks/website-quality-toolkit/issues/60) remains the actual access constraint. The prior permitted one-shot browser diagnostic produced HTTP 403 with a challenge; do not rerun it or weaken Cloudflare Bot Fight Mode.
