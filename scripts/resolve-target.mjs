import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REGISTRY_PATH = fileURLToPath(new URL('../config/targets.json', import.meta.url));

// Accepted Baseline 0.3 registry contract. Changing this identifier is a
// workstream-level decision, not a routine code change.
const REGISTRY_SCHEMA_VERSION = 'ldw.wqt-target-registry.v1';

// Opaque site-ID syntax shared with the normalizer (siteId) so normalized
// machine identity cannot drift from the target-registry contract.
export const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// The registry is a public artifact. Only these authorized deployment
// environments may appear; this keeps the "environment" field explicit
// while preventing it from becoming a place to smuggle arbitrary metadata.
const ALLOWED_ENVIRONMENTS = new Set(['production']);

// Exact, closed field sets. Anything else is rejected outright so this
// public config cannot silently accept secrets, customer records, notes, or
// other unauthorized metadata.
const ALLOWED_ROOT_FIELDS = new Set(['schemaVersion', 'sites']);
const ALLOWED_SITE_FIELDS = new Set(['id', 'origin', 'environment', 'enabled']);

export class TargetResolutionError extends Error {}

function assertPlainObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TargetResolutionError(message);
  }
}

function assertNoUnexpectedFields(value, allowedFields, label) {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw new TargetResolutionError(`${label} has an unexpected field: "${key}"`);
    }
  }
}

/**
 * A canonical HTTPS origin: `https:` scheme, no userinfo, no path/query/
 * fragment, a named (non-localhost, non-IP-literal) host, and the supplied
 * string must be byte-identical to `new URL(origin).origin`. That equality
 * check is what rejects alias forms of the same origin (trailing slash,
 * explicit default port, etc.) so exactly one string authorizes each site.
 */
function isCanonicalHttpsOrigin(value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return false;
  if (parsed.search !== '' || parsed.hash !== '') return false;
  if (!parsed.hostname) return false;
  if (parsed.hostname === 'localhost') return false;
  // Reject raw IPv4/IPv6 literals; authorized targets must be named hosts.
  if (/^[0-9.]+$/.test(parsed.hostname)) return false;
  if (parsed.hostname.includes(':')) return false;

  return value === parsed.origin;
}

/**
 * Registry entries are validated exhaustively (not only the requested entry) so a
 * corrupted, tampered, or unsafe registry fails closed before any lookup is attempted.
 */
function validateRegistry(registry, registryPath) {
  assertPlainObject(registry, `Target registry must be a JSON object: ${registryPath}`);
  assertNoUnexpectedFields(registry, ALLOWED_ROOT_FIELDS, `Target registry (${registryPath})`);

  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new TargetResolutionError(
      `Target registry has an unsupported or missing schemaVersion (expected "${REGISTRY_SCHEMA_VERSION}"): ${registryPath}`,
    );
  }

  if (!Array.isArray(registry.sites) || registry.sites.length === 0) {
    throw new TargetResolutionError(`Target registry must contain a non-empty "sites" array: ${registryPath}`);
  }

  const seenIds = new Set();
  const seenOrigins = new Set();
  for (const entry of registry.sites) {
    assertPlainObject(entry, `Each target registry entry must be a JSON object: ${registryPath}`);
    assertNoUnexpectedFields(
      entry,
      ALLOWED_SITE_FIELDS,
      `Target registry entry ${JSON.stringify(entry.id ?? null)}`,
    );

    const { id, origin, environment, enabled } = entry;
    if (typeof id !== 'string' || !SITE_ID_PATTERN.test(id)) {
      throw new TargetResolutionError(`Target registry entry has an invalid id: ${JSON.stringify(id)}`);
    }
    if (typeof enabled !== 'boolean') {
      throw new TargetResolutionError(`Target registry entry "${id}" must set "enabled" to true or false`);
    }
    if (typeof environment !== 'string' || !ALLOWED_ENVIRONMENTS.has(environment)) {
      throw new TargetResolutionError(
        `Target registry entry "${id}" must set an explicit, authorized "environment" (one of: ${[...ALLOWED_ENVIRONMENTS].join(', ')})`,
      );
    }
    if (!isCanonicalHttpsOrigin(origin)) {
      throw new TargetResolutionError(`Target registry entry "${id}" has an unsafe or non-canonical origin`);
    }

    if (seenIds.has(id)) {
      throw new TargetResolutionError(`Target registry contains a duplicate id: ${id}`);
    }
    seenIds.add(id);

    // isCanonicalHttpsOrigin already proved `origin === new URL(origin).origin`,
    // so `origin` itself is the canonical form to track for duplicate detection.
    if (seenOrigins.has(origin)) {
      throw new TargetResolutionError(`Target registry contains a duplicate canonical origin: ${origin}`);
    }
    seenOrigins.add(origin);
  }

  return registry;
}

export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(registryPath, 'utf8');
  } catch {
    throw new TargetResolutionError(`Target registry not found: ${registryPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TargetResolutionError(`Target registry is not valid JSON: ${registryPath}`);
  }

  return validateRegistry(parsed, registryPath);
}

/**
 * The machine-callable contract is: site ID -> fixed repository registry ->
 * validated exact origin -> scan. `registryPath` exists only so tests can
 * import this function directly and pass a fixture registry path; the
 * production CLI below never accepts a caller-controlled registry path.
 */
export function resolveTarget(siteIdentifier, registryPath = DEFAULT_REGISTRY_PATH) {
  if (typeof siteIdentifier !== 'string' || siteIdentifier === '') {
    throw new TargetResolutionError('Site identifier is required; no default or free-form target is permitted.');
  }
  if (!SITE_ID_PATTERN.test(siteIdentifier)) {
    throw new TargetResolutionError(`Unauthorized site identifier: ${siteIdentifier}`);
  }

  const registry = loadRegistry(registryPath);
  const match = registry.sites.find((entry) => entry.id === siteIdentifier);
  if (!match) {
    throw new TargetResolutionError(`Unauthorized site identifier: ${siteIdentifier}`);
  }
  if (!match.enabled) {
    throw new TargetResolutionError(`Site identifier is disabled in the target registry: ${siteIdentifier}`);
  }

  return match.origin;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    // No caller-controlled registry path: the production CLI always resolves
    // against the checked-in repository registry.
    const origin = resolveTarget(process.argv[2] ?? '');
    process.stdout.write(`${origin}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
