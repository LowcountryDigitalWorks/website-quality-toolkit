import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(new URL('../.github/workflows/external-links.yml', import.meta.url));
const baselineWorkflowPath = fileURLToPath(new URL('../.github/workflows/website-quality.yml', import.meta.url));
const wrapperPath = fileURLToPath(new URL('../scripts/run-external-links.sh', import.meta.url));
const workflow = fs.readFileSync(workflowPath, 'utf8');
const baselineWorkflow = fs.readFileSync(baselineWorkflowPath, 'utf8');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');
const lines = workflow.split('\n');

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length;
}

function extractBlock(startPattern) {
  const startIndex = lines.findIndex((line) => startPattern.test(line));
  assert.notEqual(startIndex, -1, `Could not find a line matching ${startPattern}`);
  const startIndent = indentOf(lines[startIndex]);
  const blockLines = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      blockLines.push(line);
      continue;
    }
    if (indentOf(line) <= startIndent) break;
    blockLines.push(line);
  }
  return blockLines.join('\n');
}

test('external-link workflow is explicit PR validation plus manual dispatch only', () => {
  assert.ok(lines.some((line) => /^\s{2}pull_request:\s*$/.test(line)));
  assert.ok(lines.some((line) => /^\s{2}workflow_dispatch:\s*$/.test(line)));
  assert.doesNotMatch(workflow, /^\s*(schedule|push|repository_dispatch):\s*$/m);
});

test('external-link workflow accepts only opaque site ID input', () => {
  const dispatch = extractBlock(/^\s{2}workflow_dispatch:\s*$/);
  const inputNames = dispatch
    .split('\n')
    .filter((line) => /^\s{6}[A-Za-z0-9_-]+:\s*$/.test(line))
    .map((line) => line.trim().replace(/:$/, ''));
  assert.deepEqual(inputNames, ['site']);
  assert.match(dispatch, /^\s*required:\s*true\s*$/m);
  assert.match(dispatch, /^\s*type:\s*string\s*$/m);
  assert.doesNotMatch(dispatch, /^\s*default:/m);
  assert.doesNotMatch(dispatch, /^\s*(url|target|registry|registry_path|registry-path):\s*$/mi);
});

test('PR validation cannot execute the real external-link probe job', () => {
  const probe = extractBlock(/^\s{2}probe:\s*$/);
  assert.match(probe, /^\s*if:\s*github\.event_name\s*==\s*'workflow_dispatch'\s*$/m);
  assert.match(probe, /run:\s*bash scripts\/run-external-links\.sh/);
  const validate = extractBlock(/^\s{2}validate:\s*$/);
  assert.doesNotMatch(validate, /run-external-links\.sh/);
  assert.doesNotMatch(validate, /scripts\/external_links\.py\s+--site-id/);
});

test('workflow permissions are contents read only and checkout credentials are disabled', () => {
  assert.equal(extractBlock(/^permissions:\s*$/).trim(), 'contents: read');
  const checkoutCount = (workflow.match(/uses:\s*actions\/checkout@/g) ?? []).length;
  const persistFalseCount = (workflow.match(/persist-credentials:\s*false/g) ?? []).length;
  assert.ok(checkoutCount >= 1);
  assert.equal(checkoutCount, persistFalseCount);
  assert.doesNotMatch(workflow, /\bsecrets\.[A-Za-z0-9_]+/);
});

test('Python SSRF-classification runtime is exact and pinned', () => {
  const setupMatches = workflow.match(/actions\/setup-python@e797f83bcb11b83ae66e0230d6156d7c80228e7c/g) ?? [];
  assert.equal(setupMatches.length, 2);
  assert.equal((workflow.match(/python-version:\s*'3\.14\.0'/g) ?? []).length, 2);
});

test('manual wrapper resolves registered site authority and exposes no URL input surface', () => {
  assert.match(wrapper, /resolve-target\.sh/);
  assert.match(wrapper, /WQT_SITE_ID/);
  assert.doesNotMatch(wrapper, /WQT_TARGET_REGISTRY/);
  assert.doesNotMatch(wrapper, /\$\{[1-9][0-9]*:-https?:/);
});

test('existing Website Quality Baseline workflow remains separate from third-party probing', () => {
  assert.doesNotMatch(baselineWorkflow, /run-external-links|external_links\.py|WQT Guarded External Link/);
});
