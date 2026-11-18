# WQT PSI v5 — offline source-only preview projection

**Status:** PROTOTYPE SOURCE ONLY / NOT INTEGRATED / NO LIVE SCANNER OR WEBSITE WIDGET. Product source freeze: [WQT #82](https://github.com/LowcountryDigitalWorks/website-quality-toolkit/issues/82). The accepted WQT target registry, SiteOne 2.5.1 and local Lighthouse 13.4.1, normalized `ldw.website-quality.v1` contract, and private `wqt-operations` JIT/pins/runner are unchanged. Nothing here imports into a WQT scan job, GAS report, Website page or endpoint.

## Business purpose

Provide a **pure local parsing/projection seam** for an already-held PageSpeed Insights v5 JSON response so a future LDW-owned visitor self-check could display a modest, honestly sourced preliminary result. This is **not** a claim that a visitor URL was checked or that any data came from Google's service. It does not produce a universal health grade, remediations, revenue/SEO ranking claims, an LDW content review, customer reports, or emails.

Official API sources: [Google PageSpeed Insights API v5](https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed) and [v5 Getting Started](https://developers.google.com/speed/docs/insights/v5/get-started). Google documents requested/final URLs, Lighthouse category scores, individual audits, Lighthouse version, reported time and device form factor; an API key is optional in examples but recommended for frequent/automated work. **No actual LDW account quota, key, entitlement, cost, permission or provider-response authenticity has been verified.** Google also plans to remove CrUX real-user data from PSI; this projection deliberately discards field data instead of conflating it with Lighthouse lab results.

## Source contract

`projectOfflinePsiPreview(rawBytes, { expectedOrigin, expectedFormFactor, selectedAuditIds? })` accepts only:

- 1–8 MiB of **already-held** UTF-8 JSON bytes; invalid bytes/JSON fail with a generic non-echoing error. It does **not** fetch, read an arbitrary file path, use DNS, run Chrome, or call the PSI endpoint.
- An independently operator-supplied simple canonical HTTPS named DNS **homepage origin** without path/fragment/query/port/userinfo/IP literal/punycode. It matches the PSI root `id`, Lighthouse `requestedUrl` and `finalUrl` exactly; redirects to a different origin or a path fail closed rather than being silently relabeled. The check is syntactic only, **not** target ownership or network safety.
- `expectedFormFactor` of desktop/mobile, matching Lighthouse `configSettings.formFactor` (with deprecated `emulatedFormFactor` as fallback). Any source conflict fails.
- Up to three **human-selected exact** audit IDs drawn from Lighthouse source `audits`, not automatic opportunity ranking.

The returned frozen projection explicitly labels `provider: 'google-pagespeed-insights-v5'` and `kind: 'ldw.wqt-psi-offline-preview.v0'`, includes the 4 fixed source category names, preserves the *native 0–1 category score* vs unscored `null` vs `not_provided`, up to three bounded source audit title/value excerpts with original audit modes, exact declared Lighthouse version/source fetch timestamp, and SHA-256 of the original response bytes. **The SHA establishes byte identity, not authenticity.** All projections have `sourceVerified:false`, `networkAuthorized:false`, `deliveryAuthorized:false`, `fieldDataIncluded:false`. A PSI runtime error rejects the input rather than pretending unavailable means healthy.

Untrusted audit text is **data**, not safe HTML/Markdown. Any future renderer MUST perform correct output-context escaping, block bare GFM autolinks, label source/unavailability and respect existing CSP/length bounds; the source string is not a customer claim. No direct display or copy of `loadingExperience` or `originLoadingExperience` is permitted.

## Synthetic proof

`node --test test/psi-preview.test.mjs` is run by existing `npm test` and WQT GitHub Baseline validation. Tests cover canonical source target, redirect/scope/strategy mismatches, source error, 0 vs missing vs `null`, exact human selection, frozen output, hostile titles, byte bounds, malformed UTF-8/JSON, declared source versus actual network proof and false authority flags. No external service or actual website is scanned in tests.

## Stage gates for actual LDW-owned visitor URL/email flow

The current [Website Check](https://github.com/LowcountryDigitalWorks/lowcountrydigitalworks.com/issues/166) is a **static noindex example**, and [Website #167](https://github.com/LowcountryDigitalWorks/lowcountrydigitalworks.com/pull/167) is an off-route validation prototype, not a functioning form. The eventual viewer path is **URL → real limited source-backed preview → email required only for the explicitly requested fuller report → separate optional marketing opt-in → one authorized report and Discovery CTA**. SellSEO Agency/Tier 2 is a reference/refund candidate, not an implementation dependency.

Before even ONE live PSI request, [Website #94](https://github.com/LowcountryDigitalWorks/lowcountrydigitalworks.com/issues/94) must separately approve a permitted target/authority/privacy/terms model, provider-specific quota/account cost evidence, bounded fixed Google API host/credentials and SSRF/redirect/IP guard, strict global admission/rate/daily cap, abuse control, report cache/retention, and an authorized staff-only Stage 2 probe. A fixed Google API hostname reduces LDW-origin arbitrary-URL egress, **but Google still fetches the user-provided website**; it does not eliminate third-party permission, abuse or privacy duties. Do not use unknown public API quota as a budget assurance, transmit customer/prospect domains from a public form, or attempt to evade Cloudflare Bot Fight Mode. Public Stage 3, actual email delivery via Zoho or another existing provider, analytics/marketing and customer fulfillment remain separately owner/Website/BO security-gated.

**Prior protected release queue P0:** WQT #80 then #81; GAS #185 then #184. This independent new draft candidate is **not release-ready**, does not supersede those projects, and cannot be merged by its GAS ORCH source author. Require exact-head hosted Baseline/Guarded/Security, author-excluded technical review, independent eligible Product release decision and postmerge Security when it is actually admitted. $0/included, no live scans, customer data or new SaaS.
