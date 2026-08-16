import fs from 'node:fs';

function formatScore(score) {
  return typeof score === 'number' ? String(Math.round(score * 100)) : 'n/a';
}

export function renderSummary(data) {
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

  return [
    '# Website Quality Baseline 0.1',
    '',
    `Target: \`${data.target}\``,
    '',
    '> Evidence only. No LDW quality threshold is applied, and SiteOne `--ci` mode is intentionally disabled.',
    '',
    '## SiteOne Crawler',
    '',
    `- Version: \`${siteone.version ?? 'unknown'}\``,
    `- Overall source score: ${siteone.overallScore ?? 'n/a'} (recorded as scanner evidence, not an LDW gate)`,
    `- Source statuses: ${statusText}`,
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
