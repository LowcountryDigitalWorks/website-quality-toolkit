import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const readme = read('README.md');
const privateRuntime = read('docs/WQT-OPS-001-PRIVATE-RUNTIME.md');
const evidenceQa = read('docs/EVIDENCE-QA.md');

test('README presents current WQT purpose before historical baseline framing', () => {
  const purposeIndex = readme.indexOf('website-specific deterministic sensing and normalized-evidence layer');
  const historyIndex = readme.indexOf('## Accepted baseline history');
  assert.ok(purposeIndex >= 0);
  assert.ok(historyIndex > purposeIndex);
  assert.match(readme, /SiteOne Crawler 2\.5\.1/);
  assert.match(readme, /Lighthouse 13\.4\.1/);
  assert.match(readme, /current effective scan profile is \*\*`site_only`\*\*/);
  assert.match(readme, /external-host skips as source coverage\/context/);
});

test('README keeps WQT, G.A.S., delivery automation, and project-test responsibilities distinct', () => {
  assert.match(readme, /G\.A\.S\. \(Generative \/ Answer \/ Search\)/);
  assert.match(readme, /Search \/ SEO \/ GEO-AIO \/ AI-visibility intelligence/);
  assert.match(readme, /WQT must not rebuild G\.A\.S\., and G\.A\.S\. must not rebuild WQT's crawler/);
  assert.match(readme, /Separately governed report\/delivery automation/);
  assert.match(readme, /Website repositories/);
});

test('README exposes source-native operator report surfaces without redefining them as WQT policy', () => {
  assert.match(readme, /`reports\/siteone\.html`/);
  assert.match(readme, /SOURCE-NATIVE SITEONE REPORT — NOT LDW QUALITY POLICY/);
  assert.match(readme, /`reports\/lighthouse\.html`/);
  assert.match(readme, /SOURCE-NATIVE LIGHTHOUSE REPORT — NOT LDW QUALITY POLICY/);
  assert.match(readme, /normalized\/website-quality\.json/);
  assert.match(readme, /not\*\* canonical WQT semantics/);
});

test('README accurately records the private runtime and deferred scan-profile boundary', () => {
  assert.match(readme, /`LowcountryDigitalWorks\/wqt-operations` is now the accepted \*\*private execution\/evidence\/history surface\*\*/);
  assert.match(readme, /WQT-SCOPE-001 #23/);
  assert.match(readme, /does not implement those profiles/);
  assert.match(readme, /Do not infer actual compression/);
  assert.match(readme, /issue #16/);
});

test('private runtime documentation reflects accepted current state without exposing private customer material', () => {
  assert.match(privateRuntime, /`LowcountryDigitalWorks\/wqt-operations` is the accepted \*\*private execution\/evidence\/history surface\*\*/);
  assert.match(privateRuntime, /no longer merely a hypothetical future wrapper/);
  assert.match(privateRuntime, /immutable accepted WQT ref/);
  assert.match(privateRuntime, /private manifests\/downstream semantic consumers remain authoritative only for the machine evidence they explicitly bind/i);
  assert.doesNotMatch(privateRuntime, /eastcoastfoamllc|donovan/i);
});

test('evidence QA checklist covers provenance, scope, semantic preservation, native reports, and real-proof gating', () => {
  for (const phrase of [
    'Source identity and provenance',
    'Authorized target and scope',
    'Raw -> normalized reconciliation',
    'Source status and finding preservation',
    'Typed-fact derivation',
    'Known source limitations and false-positive risk',
    'Summary consistency',
    'Native report coherence',
    'Fail-closed missing/unsupported evidence',
    'External coverage versus internal failure',
    'Post-merge real proof gate',
  ]) assert.match(evidenceQa, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(evidenceQa, /no extra live scan solely for presentation/);
  assert.match(evidenceQa, /Do not run a customer\/production proof from a pull request/);
});

test('all README relative Markdown links resolve to checked-in files', () => {
  const relativeLinks = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((href) => !/^[a-z]+:/i.test(href) && !href.startsWith('#'));
  assert.ok(relativeLinks.length > 0);
  for (const href of relativeLinks) {
    const filePart = href.split('#', 1)[0];
    assert.ok(fs.existsSync(path.join(root, filePart)), `README link target does not exist: ${href}`);
  }
});
