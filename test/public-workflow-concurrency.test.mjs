import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const baselineWorkflowPath = fileURLToPath(new URL('../.github/workflows/website-quality.yml', import.meta.url));
const externalWorkflowPath = fileURLToPath(new URL('../.github/workflows/external-links.yml', import.meta.url));
const targetsPath = fileURLToPath(new URL('../config/targets.json', import.meta.url));
const baselineWorkflow = fs.readFileSync(baselineWorkflowPath, 'utf8');
const externalWorkflow = fs.readFileSync(externalWorkflowPath, 'utf8');
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));

const enabledIds = targets.sites
  .filter((site) => site.enabled)
  .map((site) => site.id)
  .sort();

const workflows = [
  {
    name: 'baseline',
    text: baselineWorkflow,
    prefix: 'website-quality',
  },
  {
    name: 'external-links',
    text: externalWorkflow,
    prefix: 'wqt-external-links',
  },
];

function groupLineFor(text, prefix) {
  return text
    .split('\n')
    .find((line) => new RegExp(`^\\s{2}group:\\s+${prefix}-`).test(line));
}

function expectedGroupLine(prefix) {
  return '  group: '
    + prefix
    + "-${{ github.event_name }}-${{ github.event_name == 'workflow_dispatch' && (inputs.site == 'lowcountrydigitalworks' && 'lowcountrydigitalworks' || inputs.site == 'donovanfamilydentistry' && 'donovanfamilydentistry' || 'invalid-site') || github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || 'unsupported-event' }}";
}

function conceptualPrGroup(prefix, prNumber) {
  return `${prefix}-pull_request-pr-${prNumber}`;
}

test('public target registry has the exact closed site set covered by concurrency mapping', () => {
  assert.deepEqual(enabledIds, ['donovanfamilydentistry', 'lowcountrydigitalworks']);
});

for (const workflow of workflows) {
  test(`${workflow.name} manual concurrency uses the exact closed current-site mapping`, () => {
    const groupLine = groupLineFor(workflow.text, workflow.prefix);
    assert.equal(groupLine, expectedGroupLine(workflow.prefix));

    for (const siteId of enabledIds) {
      assert.match(groupLine, new RegExp(`inputs\\.site == '${siteId}' && '${siteId}'`));
    }
    assert.match(groupLine, /'invalid-site'/);
  });

  test(`${workflow.name} concurrency never persists raw arbitrary site or ref input`, () => {
    const groupLine = groupLineFor(workflow.text, workflow.prefix);
    assert.ok(groupLine, 'expected a workflow-level concurrency group');
    assert.doesNotMatch(
      groupLine,
      /\$\{\{\s*inputs\.site\s*\}\}/,
      'raw inputs.site must not be interpolated directly into concurrency identity',
    );
    assert.doesNotMatch(groupLine, /github\.(?:ref|head_ref|base_ref)/);
  });

  test(`${workflow.name} scopes PR cancellation to canonical pull-request number`, () => {
    const groupLine = groupLineFor(workflow.text, workflow.prefix);
    assert.match(workflow.text, /^\s{2}cancel-in-progress:\s*true\s*$/m);
    assert.match(
      groupLine,
      /github\.event_name == 'pull_request' && format\('pr-\{0\}', github\.event\.pull_request\.number\)/,
    );
    assert.match(groupLine, /\|\| 'unsupported-event' \}\}$/);

    assert.notEqual(conceptualPrGroup(workflow.prefix, 17), conceptualPrGroup(workflow.prefix, 18));
    assert.equal(conceptualPrGroup(workflow.prefix, 17), conceptualPrGroup(workflow.prefix, 17));
  });
}
