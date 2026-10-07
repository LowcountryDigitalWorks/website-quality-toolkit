import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const websiteQualityPath = fileURLToPath(new URL('../.github/workflows/website-quality.yml', import.meta.url));
const externalLinksPath = fileURLToPath(new URL('../.github/workflows/external-links.yml', import.meta.url));

const workflowFiles = [
  { name: 'website-quality.yml', path: websiteQualityPath, probeJobName: 'scan' },
  { name: 'external-links.yml', path: externalLinksPath, probeJobName: 'probe' },
];

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length;
}

function extractBlockFromLines(lines, startPattern) {
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

for (const wf of workflowFiles) {
  const content = fs.readFileSync(wf.path, 'utf8');
  const lines = content.split('\n');

  test(`[${wf.name}] a pull_request trigger exists`, () => {
    assert.ok(
      lines.some((line) => /^\s{2}pull_request:\s*$/.test(line)),
      `expected an "on.pull_request" trigger in ${wf.name}`,
    );
  });

  test(`[${wf.name}] no recurring schedule trigger exists`, () => {
    assert.ok(
      !lines.some((line) => /^\s*schedule:\s*$/.test(line)),
      `a recurring "schedule" trigger must not be present in ${wf.name}`,
    );
  });

  test(`[${wf.name}] workflow_dispatch.inputs.site is a required string input with no default`, () => {
    const dispatchBlock = extractBlockFromLines(lines, /^\s{2}workflow_dispatch:\s*$/);
    assert.match(dispatchBlock, /^\s*site:\s*$/m, 'expected a "site" input');
    assert.match(dispatchBlock, /^\s*required:\s*true\s*$/m, 'expected "required: true"');
    assert.match(dispatchBlock, /^\s*type:\s*string\s*$/m, 'expected "type: string"');
    assert.doesNotMatch(dispatchBlock, /^\s*default:/m, 'the "site" input must not set a default');
  });

  test(`[${wf.name}] workflow_dispatch exposes only the opaque site input and no URL or registry path`, () => {
    const dispatchBlock = extractBlockFromLines(lines, /^\s{2}workflow_dispatch:\s*$/);
    const inputNames = dispatchBlock
      .split('\n')
      .filter((line) => /^\s{6}[A-Za-z0-9_-]+:\s*$/.test(line))
      .map((line) => line.trim().replace(/:$/, ''));

    assert.deepEqual(inputNames, ['site']);
    assert.doesNotMatch(dispatchBlock, /^\s*(url|target|registry|registry_path|registry-path):\s*$/mi);
  });

  test(`[${wf.name}] the execution job (${wf.probeJobName}) cannot run for pull_request events`, () => {
    const jobBlock = extractBlockFromLines(lines, new RegExp(`^\\s{2}${wf.probeJobName}:\\s*$`));
    assert.match(
      jobBlock,
      /^\s*if:\s*github\.event_name\s*!=\s*'pull_request'\s*$/m,
      `the ${wf.probeJobName} job must be gated off for pull_request events`,
    );
  });

  test(`[${wf.name}] workflow permissions remain contents: read only`, () => {
    const permissionsBlock = extractBlockFromLines(lines, /^permissions:\s*$/);
    assert.equal(permissionsBlock.trim(), 'contents: read');
  });

  test(`[${wf.name}] every checkout step keeps persist-credentials: false`, () => {
    const checkoutCount = (content.match(/uses:\s*actions\/checkout@/g) ?? []).length;
    const persistFalseCount = (content.match(/persist-credentials:\s*false/g) ?? []).length;
    assert.ok(checkoutCount >= 1, `expected at least one actions/checkout step in ${wf.name}`);
    assert.equal(persistFalseCount, checkoutCount, `every checkout step must set persist-credentials: false in ${wf.name}`);
  });

  test(`[${wf.name}] the workflow does not introduce any secrets`, () => {
    assert.doesNotMatch(content, /\bsecrets\.[A-Za-z0-9_]+/, 'no ${{ secrets.* }} reference is authorized');
    assert.doesNotMatch(content, /^\s*secrets:\s*$/m, 'no top-level "secrets:" block is authorized');
  });

  test(`[${wf.name}] the public workflow cannot invoke the trusted private registry path`, () => {
    assert.doesNotMatch(content, /resolve-private-target/);
    assert.doesNotMatch(content, /WQT_TARGET_REGISTRY/);
    assert.doesNotMatch(content, /registry-path|registry_path/);
  });

  test(`[${wf.name}] the artifact upload remains local-only and includes the entire artifacts tree`, () => {
    const jobBlock = extractBlockFromLines(lines, new RegExp(`^\\s{2}${wf.probeJobName}:\\s*$`));
    assert.match(jobBlock, /Upload/);
    assert.match(jobBlock, /^\s*path:\s*artifacts\/\s*$/m);
    assert.doesNotMatch(jobBlock, /curl\s+--upload|wget\s+--post|https?:\/\//);
  });
}
