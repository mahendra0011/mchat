#!/usr/bin/env node
/**
 * Dependency license policy gate (Spec 36).
 *
 * Reads `pnpm licenses list --json`, rejects copyleft/restricted licenses, and
 * honours reviewed exceptions from docs/security/license-exceptions.json.
 * Compound licenses: "OR" passes when at least one alternative is allowed;
 * "AND" fails when any component is denied.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const exceptionsPath = join(root, 'docs', 'security', 'license-exceptions.json');

const DENIED = [/\bAGPL\b/i, /\bGPL\b/i, /\bLGPL\b/i, /\bSSPL\b/i, /\bEUPL\b/i, /\bOSL\b/i, /Commons Clause/i];

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const raw = execFileSync(pnpm, ['licenses', 'list', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const byLicense = JSON.parse(raw);
const exceptions = existsSync(exceptionsPath)
  ? JSON.parse(readFileSync(exceptionsPath, 'utf8'))
  : {};
const approved = new Set(Array.isArray(exceptions.approvedPackages) ? exceptions.approvedPackages : []);

function deniedComponent(license) {
  const text = license.trim();
  if (text.includes(' OR ')) {
    return text.split(/\s+OR\s+/).every((part) => deniedComponent(part));
  }
  if (text.includes(' AND ')) {
    return text.split(/\s+AND\s+/).some((part) => deniedComponent(part));
  }
  return DENIED.some((pattern) => pattern.test(text));
}

const violations = [];
let checked = 0;

for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    checked += 1;
    if (approved.has(pkg.name)) continue;
    if (deniedComponent(license)) {
      violations.push(`${pkg.name} (${(pkg.versions ?? []).join(', ')}) — ${license}`);
    }
  }
}

if (violations.length > 0) {
  console.error('License policy violations:');
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error(`\nAdd a reviewed exception to docs/security/license-exceptions.json (owner + expiry required).`);
  process.exit(1);
}

const licenseCount = Object.keys(byLicense).length;
console.log(`License policy OK: ${checked} packages across ${licenseCount} license expressions, 0 denied.`);
