import fs from 'node:fs';

const MAX_NON_OK_SITEONE_OBSERVATIONS = 20;
const SITEONE_STATUS_ORDER = ['CRITICAL', 'WARNING', 'NOTICE', 'INFO', 'OK', 'UNKNOWN'];

function formatLighthouseScore(score) {
  return typeof score === 'number' ? String(Math.round(score * 100)) : 'n/a';
}

function formatSourceValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.length > 0) return value;
  return 'n/a';
}

function inlineText(value, fallback = 'n/a') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replace(/\s+/g, ' ').replaceAll('`', '\\`').trim() || fallback;
}

function sourceStatus(value) {
  return typeof value === 'string' && value.length > 0 ? value : 'UNKNOWN';
}

function orderedStatusEntries(statusCounts) {
  const known = SITEONE_STATUS_ORDER
    .filter((status) => statusCounts.has(status))
    .map((status) => [status, statusCounts.get(status)]);
  const extra = [...statusCounts.entries()]
    .filter(([status]) => !SITEONE_STATUS_ORDER.includes(status))
    .sort(([a], [b]) => a.localeCompare(b));
  return [...known, ...extra];
}

function formatFacts(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return null;
  const parts = [...facts]
    .sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
    .map((fact) => {
      const id = inlineText(fact?.id, 'unknown-fact');
      const value = fact?.value === null ? 'null' : inlineText(fact?.value);
      const unit = typeof fact?.unit === 'string' && fact.unit.length > 0 ? ` ${inlineText(fact.unit)}` : '';
      return `${id}=${value}${unit}`;
    });
  return parts.join(', ');
}

function formatSiteOneCategoryScores(categoryScores) {
  if (!Array.isArray(categoryScores) || categoryScores.length === 0) return 'none';
  return [...categoryScores]
    .sort((a, b) => String(a?.code ?? a?.name ?? '').localeCompare(String(b?.code ?? b?.name ?? '')))
    .map((item) => {
      const name = inlineText(item?.name ?? item?.code, 'unknown');
      const score = formatSourceValue(item?.score);
      const label = typeof item?.label === 'string' && item.label.length > 0 ? ` (${inlineText(item.label)})` : '';
      return `${name}: ${score}${label}`;
    })
    .join(', ');
}

function formatLighthouseCategoryScores(categoryScores) {
  if (!Array.isArray(categoryScores) || categoryScores.length === 0) return 'none';
  return [...categoryScores]
    .sort((a, b) => String(a?.id ?? a?.title ?? '').localeCompare(String(b?.id ?? b?.title ?? '')))
    .map((item) => `${inlineText(item?.title ?? item?.id, 'unknown')}: ${formatLighthouseScore(item?.score)}`)
    .join(', ');
}

function skippedUrlContext(data, siteone) {
  const skippedObservation = (siteone.observations ?? []).find((item) => item.code === 'skipped');
  const supportsSkippedContext = Number.isSafeInteger(data.schemaMinorVersion)
    && data.schemaMinorVersion >= 3;
  if (!supportsSkippedContext || !skippedObservation || !Array.isArray(skippedObservation.facts)) return null;

  const values = new Map(
    skippedObservation.facts
      .filter((fact) => fact?.valueType === 'number' && Number.isSafeInteger(fact.value))
      .map((fact) => [fact.id, fact.value]),
  );
  const total = values.get('skipped-url-count');
  const externalNotAllowed = values.get('external-not-allowed-host-count');
  const internal = values.get('internal-skipped-url-count');
  const other = values.get('other-skipped-url-count');

  if (![total, externalNotAllowed, internal, other].every(Number.isSafeInteger)) return null;
  if (total > 0 && externalNotAllowed === total && internal === 0 && other === 0) {
    return `${externalNotAllowed} external-host URL(s) intentionally skipped under current \`site_only\` same-authority crawl scope; no internal or other skipped URLs`;
  }
  return `${total} total; ${externalNotAllowed} external-host Not allowed host; ${internal} internal; ${other} other`;
}

function nonOkSiteOneLines(siteone) {
  const rank = new Map(SITEONE_STATUS_ORDER.map((status, index) => [status, index]));
  const observations = (siteone.observations ?? [])
    .filter((item) => sourceStatus(item?.sourceStatus) !== 'OK')
    .sort((a, b) => {
      const aStatus = sourceStatus(a?.sourceStatus);
      const bStatus = sourceStatus(b?.sourceStatus);
      const aRank = rank.get(aStatus) ?? SITEONE_STATUS_ORDER.length;
      const bRank = rank.get(bStatus) ?? SITEONE_STATUS_ORDER.length;
      return aRank - bRank
        || aStatus.localeCompare(bStatus)
        || String(a?.code ?? '').localeCompare(String(b?.code ?? ''))
        || String(a?.message ?? '').localeCompare(String(b?.message ?? ''));
    });

  if (observations.length === 0) {
    return ['- No non-OK SiteOne summary observations are present in normalized evidence; this is not an LDW health verdict.'];
  }

  const shown = observations.slice(0, MAX_NON_OK_SITEONE_OBSERVATIONS).map((item) => {
    const status = inlineText(sourceStatus(item?.sourceStatus));
    const code = inlineText(item?.code, 'unknown-code');
    const message = inlineText(item?.message, 'No source message');
    const facts = formatFacts(item?.facts);
    return `- **${status}** \`${code}\` — ${message}${facts ? ` — facts: ${facts}` : ''}`;
  });
  if (observations.length > shown.length) {
    shown.push(`- _${observations.length - shown.length} additional non-OK source observation(s) omitted by the ${MAX_NON_OK_SITEONE_OBSERVATIONS}-item presentation bound; inspect normalized/raw evidence for the full set._`);
  }
  return shown;
}

export function renderSummary(data) {
  // Only the major schema identifier gates support; `schemaMinorVersion` is
  // purely additive, so an unknown or absent minor version is not an error.
  if (data?.schemaVersion !== 'ldw.website-quality.v1') throw new Error('Unsupported normalized evidence schema');
  const siteone = data.sources?.siteone;
  const lighthouse = data.sources?.lighthouse;
  if (!siteone || !lighthouse) throw new Error('Normalized evidence is missing sources');

  const statusCounts = new Map();
  for (const item of siteone.observations ?? []) {
    const status = sourceStatus(item?.sourceStatus);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const statusText = orderedStatusEntries(statusCounts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ') || 'none';

  const skippedContext = skippedUrlContext(data, siteone);
  const siteoneCategories = formatSiteOneCategoryScores(siteone.categoryScores);
  const lighthouseScores = formatLighthouseCategoryScores(lighthouse.categoryScores);
  const nonOkLines = nonOkSiteOneLines(siteone);
  const siteoneTime = inlineText(siteone.executedAt, 'not supplied by source');
  const lighthouseTime = inlineText(lighthouse.fetchTime, 'not supplied by source');

  return [
    '# Website Quality Evidence Summary',
    '',
    `Site: \`${data.siteId ?? 'unknown'}\``,
    `Target: \`${data.target}\``,
    '',
    '> Evidence only. SiteOne and Lighthouse statuses/scores are **SOURCE-NATIVE** scanner evidence. SiteOne `--ci` mode is intentionally disabled; WQT applies no LDW quality threshold, combined health score, severity, priority, ranking-impact conclusion, or remediation recommendation.',
    '',
    '## Scan Scope',
    '',
    '- Current profile: `site_only`.',
    '- SiteOne: whole-site same-authority crawl evidence. External URLs may be discovered, but arbitrary third-party hosts are not recursively crawled.',
    '- Lighthouse: focused homepage desktop lab evidence.',
    '- External-host skips under `site_only` are coverage context. Their source status is preserved, but WQT does not convert an intentional external-host skip into an LDW site-failure verdict.',
    '',
    '## Source Timing',
    '',
    `- SiteOne source \`executedAt\`: ${siteoneTime}`,
    `- Lighthouse source \`fetchTime\`: ${lighthouseTime}`,
    '',
    '## SiteOne Crawler',
    '',
    `- Version: \`${siteone.version ?? 'unknown'}\``,
    `- Overall source score (**SOURCE-NATIVE**): ${formatSourceValue(siteone.overallScore)}`,
    `- Category source scores (**SOURCE-NATIVE**): ${siteoneCategories}`,
    `- Source statuses: ${statusText}`,
    ...(skippedContext ? [`- Skipped URL context: ${skippedContext}`] : []),
    '',
    `### Non-OK source observations (maximum ${MAX_NON_OK_SITEONE_OBSERVATIONS} shown)`,
    '',
    ...nonOkLines,
    '',
    '## Lighthouse',
    '',
    `- Version: \`${lighthouse.version ?? 'unknown'}\``,
    `- Category scores (**SOURCE-NATIVE** desktop lab evidence, 0-100): ${lighthouseScores}`,
    '',
    '## Artifact Guide',
    '',
    '- `raw/siteone.json` — SiteOne machine evidence from the accepted crawl.',
    '- `raw/lighthouse.json` — Lighthouse machine evidence from the same focused lab execution that produced its HTML report.',
    '- `reports/siteone.html` — **SOURCE-NATIVE SITEONE REPORT — NOT LDW QUALITY POLICY**.',
    '- `reports/lighthouse.html` — **SOURCE-NATIVE LIGHTHOUSE REPORT — NOT LDW QUALITY POLICY**.',
    '- `normalized/website-quality.json` — stable WQT machine contract for downstream consumers such as G.A.S.',
    '- This summary is a bounded source-neutral landing page. The workflow artifact retains the raw/detail and normalized evidence; the source-native HTML reports are operator/remediation/debug presentation, not canonical WQT semantics.',
    '',
    'Broader longitudinal and cross-source Search / SEO / GEO-AIO / AI-visibility interpretation belongs downstream in G.A.S.; separately governed delivery automation may render approved client-facing output later.',
    '',
    ...(siteone.version === '2.5.1' ? [
      '## Known Current Limitation',
      '',
      '- WQT-SEM-003 / issue #16: pinned SiteOne 2.5.1 may emit a Brotli-support source warning, but current accepted evidence does not establish whether actual delivery used `zstd`, `br`, `gzip`, or none. Do not infer actual compression from that warning.',
      '',
    ] : []),
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const input = process.argv[2];
    if (!input) throw new Error('Usage: node scripts/write-summary.mjs <normalized-json>');
    const data = JSON.parse(fs.readFileSync(input, 'utf8'));
    process.stdout.write(renderSummary(data));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
