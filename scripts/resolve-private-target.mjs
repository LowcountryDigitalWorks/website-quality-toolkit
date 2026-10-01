import { resolveTarget } from './resolve-target.mjs';

const args = process.argv.slice(2);

if (args.length !== 2) {
  process.stderr.write('Usage: node scripts/resolve-private-target.mjs <registry-path> <site-id>\n');
  process.exitCode = 2;
} else {
  const [registryPath, siteIdentifier] = args;
  try {
    const origin = resolveTarget(siteIdentifier, registryPath);
    process.stdout.write(`${origin}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
