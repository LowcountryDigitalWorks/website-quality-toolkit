import fs from 'node:fs';

function formatScore(score) {
  return typeof score === 'number' ? String(Math.round(score * 100)) : 'n/a';
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
    const status = item.sourceStatus ?? 'UNKNOWN';
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const orderedStatuses = ['CRITICAL', 'WARNING', 'NOTICE', 'INFO', 'OK', 'UNKNOWN'];
  const statusText = orderedStatuses
    .filter((status) => statusCounts.has(status))
    .map((status) => `${status}: ${statusCounts.get(status)}`)
    .join(', ') || 'none';

  const lighthouseScores = (lighthouse.categoryScores ?? [])
    .map((item) => `${item.title ?? item.id}: ${formatScore(item.score)}`)
    .join(', ') || 'none';

  let skippedContext = null;
  const skippedObservation = (siteone.observations ?? []).find((item) => item.code === 'skipped');
  const supportsSkippedContext = Number.isSafeInteger(data.schemaMinorVersion)
    && data.schemaMinorVersion >= 3;
  if (supportsSkippedContext && skippedObservation && Array.isArray(skippedObservation.facts)) {
    const values = new Map(
      skippedObservation.facts
        .filter((fact) => fact?.valueType === 'number' && Number.isSafeInteger(fact.value))
        .map((fact) => [fact.id, fact.value]),
    );
    const total = values.get('skipped-url-count');
    const externalNotAllowed = values.get('external-not-allowed-host-count');
    const internal = values.get('internal-skipped-url-count');
    const other = values.get('other-skipped-url-count');

    if ([total, externalNotAllowed, internal, other].every(Number.isSafeInteger)) {
      if (total > 0 && externalNotAllowed === total && internal === 0 && other === 0) {
        skippedContext = `${externalNotAllowed} external-host URL(s) intentionally skipped by the same-host crawl policy; no internal or other skipped URLs`;
      } else {
        skippedContext = `${total} total; ${externalNotAllowed} external-host Not allowed host; ${internal} internal; ${other} other`;
      }
    }
  }

  return [
    '# Website Quality Evidence Summary',
    '',
    `Site: \`${data.siteId ?? 'unknown'}\``,
    `Target: \`${data.target}\``,
    '',
    '> Evidence only. No LDW quality threshold is applied, and SiteOne `--ci` mode is intentionally disabled.',
    '',
    '## SiteOne Crawler',
    '',
    `- Version: \`${siteone.version ?? 'unknown'}\``,
    `- Overall source score: ${siteone.overallScore ?? 'n/a'} (recorded as scanner evidence, not an LDW gate)`,
    `- Source statuses: ${statusText}`,
    ...(skippedContext ? [`- Skipped URL context: ${skippedContext}`] : []),
    '',
    '## Lighthouse',
    '',
    `- Version: \`${lighthouse.version ?? 'unknown'}\``,
    `- Category scores (0-100): ${lighthouseScores}`,
    '',
    'Raw and normalized JSON are retained in the workflow artifact for classification as actionable, duplicate, informational, or noise.',
    '',
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
