const jsonMode = !process.stdout.isTTY || process.env.BB1688_JSON === '1';

export function isJson(): boolean {
  return jsonMode;
}

export function emit(opts: { human: () => void; data: unknown }): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(opts.data) + '\n');
  } else {
    opts.human();
  }
}

export function info(msg: string): void {
  if (!jsonMode) process.stderr.write(`${msg}\n`);
}
