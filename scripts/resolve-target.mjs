import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REGISTRY_PATH = fileURLToPath(new URL('../config/targets.json', import.meta.url));
const REGISTRY_SCHEMA_VERSION = 'ldw.website-quality-targets.v1';
const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export class TargetResolutionError extends Error {}

function assertPlainObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TargetResolutionError(message);
  }
}

function isSafeHttpsOrigin(value) {
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

  return true;
}

/**
 * Registry entries are validated exhaustively (not only the requested entry) so a
 * corrupted or unsafe registry fails closed before any lookup is attempted.
 */
function validateRegistry(registry, registryPath) {
  assertPlainObject(registry, `Target registry must be a JSON object: ${registryPath}`);

  if (registry.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    throw new TargetResolutionError(
      `Target registry has an unsupported or missing schemaVersion (expected "${REGISTRY_SCHEMA_VERSION}"): ${registryPath}`,
    );
  }

  if (!Array.isArray(registry.targets) || registry.targets.length === 0) {
    throw new TargetResolutionError(`Target registry must contain a non-empty "targets" array: ${registryPath}`);
  }

  const seenIds = new Set();
  for (const entry of registry.targets) {
    assertPlainObject(entry, `Each target registry entry must be a JSON object: ${registryPath}`);

    const { id, url, enabled } = entry;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new TargetResolutionError(`Target registry entry has an invalid id: ${JSON.stringify(id)}`);
    }
    if (typeof enabled !== 'boolean') {
      throw new TargetResolutionError(`Target registry entry "${id}" must set "enabled" to true or false`);
    }
    if (!isSafeHttpsOrigin(url)) {
      throw new TargetResolutionError(`Target registry entry "${id}" has an unsafe or malformed url`);
    }
    if (seenIds.has(id)) {
      throw new TargetResolutionError(`Target registry contains a duplicate id: ${id}`);
    }
    seenIds.add(id);
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

export function resolveTarget(siteIdentifier, registryPath = DEFAULT_REGISTRY_PATH) {
  if (typeof siteIdentifier !== 'string' || siteIdentifier === '' || siteIdentifier.trim() !== siteIdentifier) {
    throw new TargetResolutionError('Site identifier is required; no default or free-form target is permitted.');
  }
  if (siteIdentifier.includes('://') || siteIdentifier.includes('/') || siteIdentifier.includes('.')) {
    throw new TargetResolutionError(`Unauthorized site identifier: ${siteIdentifier}`);
  }

  const registry = loadRegistry(registryPath);
  const match = registry.targets.find((entry) => entry.id === siteIdentifier);
  if (!match) {
    throw new TargetResolutionError(`Unauthorized site identifier: ${siteIdentifier}`);
  }
  if (!match.enabled) {
    throw new TargetResolutionError(`Site identifier is disabled in the target registry: ${siteIdentifier}`);
  }

  return match.url;
}

function resolveRegistryPathFromEnv() {
  const override = process.env.WQT_TARGET_REGISTRY;
  return override ? path.resolve(override) : DEFAULT_REGISTRY_PATH;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    const url = resolveTarget(process.argv[2] ?? '', resolveRegistryPathFromEnv());
    process.stdout.write(`${url}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
