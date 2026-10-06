# WQT Evidence QA

Use this checklist for every scanner-version change, normalized-semantic change, or other WQT release that can change real evidence/report behavior.

WQT QA verifies evidence integrity and operator truth. It does **not** create an LDW health score, automatic priority, remediation decision, or client narrative.

## Required checklist

1. **Source identity and provenance**
   - Verify the exact pinned SiteOne/Lighthouse version, artifact/lock identity, and execution provenance.
   - Confirm no unreviewed scanner/provider version drift.

2. **Authorized target and scope**
   - Verify the opaque authorized site/target resolves through the accepted public or private authority boundary.
   - Record the effective scan scope/profile. Current accepted behavior is `site_only` unless a later profile is separately authorized.
   - Never treat a page-discovered foreign host as permission to crawl it.

3. **Raw -> normalized reconciliation**
   - Verify expected source counts/identities against normalized observations.
   - Confirm formatting/order-only differences do not change semantic output where the contract says they should not.
   - Confirm no truncation, silent deduplication, or invented default occurs.

4. **Source status and finding preservation**
   - Verify SiteOne source status, observation code, source message, and retained source-native score/category evidence remain truthful.
   - Verify Lighthouse category/audit evidence retains source values without LDW reinterpretation.

5. **Typed-fact derivation**
   - Where bounded typed facts exist, reconcile them against the exact supported source fields/tables.
   - Test zero, missing, malformed, duplicate, and bound-edge behavior explicitly.

6. **Known source limitations and false-positive risk**
   - Identify scanner limitations that affect interpretation.
   - Current example: WQT-SEM-003 / #16 — SiteOne 2.5.1's Brotli-support warning does not establish actual `Content-Encoding`; do not infer `zstd`, `br`, `gzip`, or none from that warning.

7. **Summary consistency**
   - Verify the WQT operator summary agrees with normalized evidence.
   - Source-native scores/statuses must be labeled source-native, not LDW severity/policy.
   - Verify deterministic ordering and any explicit presentation bound/omitted-count behavior.

8. **Native report coherence**
   - If scanner-native HTML reports are retained, verify the report and raw JSON come from the same scanner execution.
   - Confirm fixed local artifact paths, no report upload/mail/AI mode, and no extra live scan solely for presentation.
   - Treat native HTML as operator/debug/remediation presentation, not canonical WQT semantics.

9. **Fail-closed missing/unsupported evidence**
   - Prove missing, unavailable, partial, malformed, future/unsupported, or otherwise unrepresentable evidence never becomes `healthy`, numeric zero, or unchanged unless the accepted contract explicitly establishes that value/state.

10. **External coverage versus internal failure**
    - Under current `site_only` behavior, distinguish intentionally unscanned external-host coverage from actual internal/other skip conditions.
    - Preserve the upstream source status while making the coverage context explicit; do not convert source-native `CRITICAL` mechanically into an LDW critical site defect.

11. **Post-merge real proof gate**
    - If the release changes real scanner/report behavior, run at most the separately authorized post-merge real proof specified by Product.
    - Do not run a customer/production proof from a pull request or without explicit authorization.
    - Reconcile exact run/artifact identity and return evidence to the owning workstream.

## Release evidence to retain

For the reviewed release/candidate, record at minimum:

- base/head/tree identity;
- scanner and dependency pins;
- changed files;
- full test counts/results;
- shell/Node syntax checks;
- PR workflow run/jobs and confirmation that live scan is skipped on PR;
- normalized contract/schema impact (including `NONE` when unchanged);
- source-native report disposition and artifact-size observations when reports change;
- security/privacy/cost impact;
- unresolved upstream/source limitations.

## Boundaries

Evidence QA does not authorize:

- customer/private fixtures in the public repository;
- QA SaaS or a new database;
- runtime AI summaries;
- unrestricted external crawling;
- provider credentials;
- automatic remediation/issue creation;
- recurrence/scheduling;
- a custom dashboard merely because native source presentation is imperfect.
