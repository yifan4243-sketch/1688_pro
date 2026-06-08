#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(root, relPath), 'utf8');
}

async function exists(relPath) {
  try {
    await fs.access(path.join(root, relPath));
    return true;
  } catch {
    return false;
  }
}

const requiredFiles = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'docs/AGENT_WORKING_PRINCIPLES.md',
  'docs/README.md',
  'docs/WORKFLOW.md',
  'docs/COMMANDS.md',
  'docs/JSON_CONTRACTS.md',
  'docs/SAFETY.md',
  'docs/RELIABILITY.md',
  'docs/QUALITY_SCORE.md',
  'docs/FEATURES.md',
  'docs/specs/sourcing-research.md',
  'docs/specs/seller-im.md',
  'docs/specs/checkout-and-orders.md',
  'docs/playbooks/add-command.md',
  'docs/playbooks/change-json-output.md',
  'docs/playbooks/debug-risk-control.md',
  'docs/playbooks/add-mtop-capture.md',
  'docs/playbooks/update-cli-release.md',
  'docs/records/release-omissions.md',
  'docs/generated/command-index.md',
  'docs/generated/module-map.md',
  'docs/generated/test-index.md',
  'docs/generated/json-shapes.md',
];

const missing = [];
for (const file of requiredFiles) {
  if (!(await exists(file))) missing.push(file);
}

const failures = [];
if (missing.length) failures.push(`Missing files: ${missing.join(', ')}`);

const agents = await read('AGENTS.md').catch(() => '');
if (!agents.includes('pnpm agent-verify'))
  failures.push('AGENTS.md must mention pnpm agent-verify.');
if (!agents.includes('docs/playbooks'))
  failures.push('AGENTS.md must route work to docs/playbooks.');
if (!agents.includes('docs/AGENT_WORKING_PRINCIPLES.md'))
  failures.push('AGENTS.md must link docs/AGENT_WORKING_PRINCIPLES.md.');
if (agents.split('\n').length > 220)
  failures.push('AGENTS.md should stay short (<= 220 lines).');

const pkg = JSON.parse(await read('package.json'));
for (const scriptName of ['agent-context', 'docs-check', 'agent-map-check', 'release-check', 'agent-verify']) {
  if (!pkg.scripts?.[scriptName]) failures.push(`package.json missing script: ${scriptName}`);
}

const docsReadme = await read('docs/README.md').catch(() => '');
for (const needle of [
  'AGENT_WORKING_PRINCIPLES.md',
  'COMMANDS.md',
  'JSON_CONTRACTS.md',
  'SAFETY.md',
  'generated/',
]) {
  if (!docsReadme.includes(needle)) failures.push(`docs/README.md must link ${needle}.`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Agent map structure looks good.');
