import fs from 'node:fs/promises';
import { CliError } from '../io/errors.js';
import { configFile } from './paths.js';

export interface AppConfig {
  defaultProfile?: string;
  timeouts?: {
    searchMtopMs?: number;
    headedVerificationMs?: number;
    navigationMs?: number;
  };
  artifacts?: {
    retentionDays?: number;
  };
  daemon?: {
    headed?: boolean;
  };
  writeActions?: {
    confirmBeforeCheckout?: boolean;
  };
}

const OBJECT_KEYS = new Set([
  'defaultProfile',
  'timeouts',
  'artifacts',
  'daemon',
  'writeActions',
]);

export async function readConfig(): Promise<AppConfig> {
  let text: string;
  try {
    text = await fs.readFile(configFile(), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new CliError(2, 'CONFIG_ERROR', `Cannot read config: ${(e as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new CliError(2, 'CONFIG_ERROR', `Invalid JSON in config: ${(e as Error).message}`);
  }
  return validateConfig(value);
}

export function validateConfig(value: unknown): AppConfig {
  if (!isRecord(value)) {
    throw new CliError(2, 'CONFIG_ERROR', 'Config must be a JSON object.');
  }
  for (const key of Object.keys(value)) {
    if (!OBJECT_KEYS.has(key)) {
      throw new CliError(2, 'CONFIG_ERROR', `Unknown config key: ${key}`);
    }
  }
  const cfg = value as AppConfig;
  if (cfg.defaultProfile !== undefined && typeof cfg.defaultProfile !== 'string') {
    throw new CliError(2, 'CONFIG_ERROR', 'defaultProfile must be a string.');
  }
  validateNumberObject(cfg.timeouts, 'timeouts', [
    'searchMtopMs',
    'headedVerificationMs',
    'navigationMs',
  ]);
  validateNumberObject(cfg.artifacts, 'artifacts', ['retentionDays']);
  validateBooleanObject(cfg.daemon, 'daemon', ['headed']);
  validateBooleanObject(cfg.writeActions, 'writeActions', ['confirmBeforeCheckout']);
  return cfg;
}

function validateNumberObject(
  value: unknown,
  name: string,
  keys: string[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new CliError(2, 'CONFIG_ERROR', `${name} must be an object.`);
  for (const [key, raw] of Object.entries(value)) {
    if (!keys.includes(key)) throw new CliError(2, 'CONFIG_ERROR', `Unknown config key: ${name}.${key}`);
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      throw new CliError(2, 'CONFIG_ERROR', `${name}.${key} must be a non-negative number.`);
    }
  }
}

function validateBooleanObject(
  value: unknown,
  name: string,
  keys: string[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new CliError(2, 'CONFIG_ERROR', `${name} must be an object.`);
  for (const [key, raw] of Object.entries(value)) {
    if (!keys.includes(key)) throw new CliError(2, 'CONFIG_ERROR', `Unknown config key: ${name}.${key}`);
    if (typeof raw !== 'boolean') {
      throw new CliError(2, 'CONFIG_ERROR', `${name}.${key} must be a boolean.`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
