// Output shaping for human + agent consumers.
//
// `emit()` is called by each command's `run()` with both a human renderer
// and the raw data object. The four global flags (`--json`, `--pretty`,
// `--get`, `--pick`) plus the existing TTY/BB1688_JSON detection decide
// which branch wins:
//
//   --get <path>    Resolve a dot-path (`a.b[0].c`, `arr[*].x`) and print.
//                   Scalar → raw line. Object/array → JSON. Wildcards
//                   stream one line per element.
//   --pick <paths>  Comma-separated dot-paths → emit a JSON object with
//                   each path as a key.
//   --json          Force JSON even when stdout is a TTY.
//   --pretty        Indent JSON output by 2 spaces.
//
// CLI wiring sets these via `setOutputFlags()` from a commander preAction
// hook (see `src/cli.ts`).

let _forceJson = false;
let _pretty = false;
let _getPath: string | null = null;
let _pickPaths: string[] | null = null;

const jsonModeFromEnv =
  !process.stdout.isTTY || process.env.BB1688_JSON === '1';

export interface OutputFlags {
  json?: boolean;
  pretty?: boolean;
  get?: string;
  pick?: string;
}

export function setOutputFlags(o: OutputFlags): void {
  _forceJson = !!o.json;
  _pretty = !!o.pretty;
  _getPath = o.get ?? null;
  _pickPaths = o.pick
    ? o.pick
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
}

export function isJson(): boolean {
  return _forceJson || jsonModeFromEnv;
}

function stringify(v: unknown): string {
  return _pretty ? JSON.stringify(v, null, 2) : JSON.stringify(v);
}

export function emit(opts: { human: () => void; data: unknown }): void {
  if (_getPath !== null) {
    const tokens = parsePath(_getPath);
    const result = resolve(opts.data, tokens);
    if (result.wildcard && Array.isArray(result.value)) {
      for (const el of result.value) emitOne(el);
    } else {
      emitOne(result.value);
    }
    return;
  }
  if (_pickPaths !== null) {
    const out: Record<string, unknown> = {};
    for (const p of _pickPaths) {
      const tokens = parsePath(p);
      out[p] = resolve(opts.data, tokens).value;
    }
    process.stdout.write(stringify(out) + '\n');
    return;
  }
  if (isJson()) {
    process.stdout.write(stringify(opts.data) + '\n');
  } else {
    opts.human();
  }
}

export function info(msg: string): void {
  if (!isJson()) process.stderr.write(`${msg}\n`);
}

// ---------- internal path resolver ----------

type PathToken =
  | { type: 'field'; name: string }
  | { type: 'index'; idx: number }
  | { type: 'wildcard' };

function parsePath(p: string): PathToken[] {
  const out: PathToken[] = [];
  let i = 0;
  while (i < p.length) {
    if (p[i] === '.') {
      i++;
      continue;
    }
    if (p[i] === '[') {
      const close = p.indexOf(']', i);
      if (close < 0) throw new Error(`unclosed [ in path: ${p}`);
      const inner = p.slice(i + 1, close);
      if (inner === '*') {
        out.push({ type: 'wildcard' });
      } else {
        const n = parseInt(inner, 10);
        if (!Number.isFinite(n)) {
          throw new Error(`bad index [${inner}] in path: ${p}`);
        }
        out.push({ type: 'index', idx: n });
      }
      i = close + 1;
      continue;
    }
    // field name until next '.' or '['
    let j = i;
    while (j < p.length && p[j] !== '.' && p[j] !== '[') j++;
    out.push({ type: 'field', name: p.slice(i, j) });
    i = j;
  }
  return out;
}

interface ResolveResult {
  wildcard: boolean;
  value: unknown;
}

function resolve(data: unknown, tokens: PathToken[]): ResolveResult {
  let cur: unknown = data;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (cur === null || cur === undefined) {
      return { wildcard: false, value: undefined };
    }
    if (tok.type === 'field') {
      if (typeof cur !== 'object' || Array.isArray(cur)) {
        return { wildcard: false, value: undefined };
      }
      cur = (cur as Record<string, unknown>)[tok.name];
    } else if (tok.type === 'index') {
      if (!Array.isArray(cur)) return { wildcard: false, value: undefined };
      cur = cur[tok.idx];
    } else {
      // wildcard
      if (!Array.isArray(cur)) return { wildcard: false, value: undefined };
      const rest = tokens.slice(i + 1);
      const expanded = cur.map((el) => resolve(el, rest).value);
      return { wildcard: true, value: expanded };
    }
  }
  return { wildcard: false, value: cur };
}

function emitOne(v: unknown): void {
  if (v === undefined) return;
  if (v === null) {
    process.stdout.write('null\n');
  } else if (typeof v === 'object') {
    process.stdout.write(stringify(v) + '\n');
  } else {
    process.stdout.write(String(v) + '\n');
  }
}
