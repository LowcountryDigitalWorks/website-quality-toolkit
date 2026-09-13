import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Dependency-free structural checks against the workflow YAML text. This
// deliberately does not add a YAML parser: the file's shape is small,
// controlled, and owned entirely by this repository, so line-indentation
// based block extraction is sufficient to mechanically prove the release
// invariants below.
const workflowPath = fileURLToPath(new URL('../.github/workflows/website-quality.yml', import.meta.url));
const workflow = fs.readFileSync(workflowPath, 'utf8');
const lines = workflow.split('\n');

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length;
}

/** Returns the body of a block introduced by the first line matching `startPattern`. */
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

test('a pull_request trigger exists', () => {
  assert.ok(
    lines.some((line) => /^\s{2}pull_request:\s*$/.test(line)),
    'expected an "on.pull_request" trigger',
  );
});

test('no recurring schedule trigger exists', () => {
  assert.ok(
    !lines.some((line) => /^\s*schedule:\s*$/.test(line)),
    'a recurring "schedule" trigger must not be present',
  );
});

test('workflow_dispatch.inputs.site is a required string input with no default', () => {
  const dispatchBlock = extractBlock(/^\s{2}workflow_dispatch:\s*$/);
  assert.match(dispatchBlock, /^\s*site:\s*$/m, 'expected a "site" input');
  assert.match(dispatchBlock, /^\s*required:\s*true\s*$/m, 'expected "required: true"');
  assert.match(dispatchBlock, /^\s*type:\s*string\s*$/m, 'expected "type: string"');
  assert.doesNotMatch(dispatchBlock, /^\s*default:/m, 'the "site" input must not set a default');
});

test('the scan (production evidence collection) job cannot run for pull_request events', () => {
  const scanBlock = extractBlock(/^\s{2}scan:\s*$/);
  assert.match(
    scanBlock,
    /^\s*if:\s*github\.event_name\s*!=\s*'pull_request'\s*$/m,
    'the scan job must be gated off for pull_request events',
  );
});

test('workflow permissions remain contents: read only', () => {
  const permissionsBlock = extractBlock(/^permissions:\s*$/);
  assert.equal(permissionsBlock.trim(), 'contents: read');
});

test('every checkout step keeps persist-credentials: false', () => {
  const checkoutCount = (workflow.match(/uses:\s*actions\/checkout@/g) ?? []).length;
  const persistFalseCount = (workflow.match(/persist-credentials:\s*false/g) ?? []).length;
  assert.ok(checkoutCount >= 1, 'expected at least one actions/checkout step');
  assert.equal(persistFalseCount, checkoutCount, 'every checkout step must set persist-credentials: false');
});

test('the workflow does not introduce any secrets', () => {
  assert.doesNotMatch(workflow, /\bsecrets\.[A-Za-z0-9_]+/, 'no ${{ secrets.* }} reference is authorized');
  assert.doesNotMatch(workflow, /^\s*secrets:\s*$/m, 'no top-level "secrets:" block is authorized');
});
