import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(new URL('../.github/workflows/website-quality.yml', import.meta.url));
const targetsPath = fileURLToPath(new URL('../config/targets.json', import.meta.url));
const workflow = fs.readFileSync(workflowPath, 'utf8');
const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8'));

const groupLine = workflow
  .split('\n')
  .find((line) => /^\s{2}group:\s+website-quality-/.test(line));

const expectedGroupLine = "  group: website-quality-${{ github.event_name }}-${{ github.event_name == 'workflow_dispatch' && (inputs.site == 'lowcountrydigitalworks' && 'lowcountrydigitalworks' || inputs.site == 'donovanfamilydentistry' && 'donovanfamilydentistry' || 'invalid-site') || 'validation' }}";

test('public workflow manual concurrency uses the exact closed current-site mapping', () => {
  assert.equal(groupLine, expectedGroupLine);

  const enabledIds = targets.sites
    .filter((site) => site.enabled)
    .map((site) => site.id)
    .sort();

  assert.deepEqual(enabledIds, ['donovanfamilydentistry', 'lowcountrydigitalworks']);
  for (const siteId of enabledIds) {
    assert.match(groupLine, new RegExp(`inputs\\.site == '${siteId}' && '${siteId}'`));
  }
  assert.match(groupLine, /'invalid-site'/);
});

test('public workflow concurrency never persists raw arbitrary site input', () => {
  assert.ok(groupLine, 'expected a workflow-level concurrency group');
  assert.doesNotMatch(
    groupLine,
    /\$\{\{\s*inputs\.site\s*\}\}/,
    'raw inputs.site must not be interpolated directly into concurrency identity',
  );
});

test('public workflow keeps cancellation enabled and PR grouping site-independent', () => {
  assert.match(workflow, /^\s{2}cancel-in-progress:\s*true\s*$/m);
  assert.match(groupLine, /\|\| 'validation' \}\}$/);
});
