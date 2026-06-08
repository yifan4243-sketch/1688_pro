#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(path.join(root, relPath), 'utf8'));
}

async function read(relPath) {
  return fs.readFile(path.join(root, relPath), 'utf8');
}

const pkg = await readJson('package.json');
const changelog = await read('CHANGELOG.md');

const version = pkg.version;
const releaseHeading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
const failures = [];

if (!releaseHeading.test(changelog)) {
  failures.push(`CHANGELOG.md missing release heading for package version ${version}.`);
}

if (!pkg.files?.includes('CHANGELOG.md')) {
  failures.push('package.json files must include CHANGELOG.md.');
}

if (!pkg.scripts?.['release-check']) {
  failures.push('package.json missing script: release-check.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Release metadata looks good for ${pkg.name}@${version}.`);
