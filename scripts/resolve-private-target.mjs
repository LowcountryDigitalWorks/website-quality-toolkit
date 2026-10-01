import { resolveTarget } from './resolve-target.mjs';

const USAGE = 'Usage: node scripts/resolve-private-target.mjs <registry-path> <site-id>\n';
const FAILURE = 'Private target resolution failed.\n';

function main() {
  if (process.argv.length !== 4) {
    process.stderr.write(USAGE);
    return 2;
  }

  const [registryPath, siteIdentifier] = process.argv.slice(2);
  try {
    const origin = resolveTarget(siteIdentifier, registryPath);
    process.stdout.write(`${origin}\n`);
    return 0;
  } catch {
    // The private registry may contain confidential target metadata. Keep CLI
    // diagnostics intentionally generic rather than echoing registry contents,
    // unrelated entries, origins, or caller-supplied private values.
    process.stderr.write(FAILURE);
    return 2;
  }
}

process.exitCode = main();
