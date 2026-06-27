/**
 * Normalise process.argv so the CLI works regardless of how it was invoked:
 *   node dist/cli.js doctor --json
 *   1688 doctor --json
 *   ELECTRON_RUN_AS_NODE=1 exe "resources/cli/dist/cli.js" doctor --json
 *
 * Commander would otherwise treat "dist/cli.js" or the electron exe as a
 * command name and fail with "unknown command".
 */
export function sanitiseCliArgs(argv: string[] = process.argv): string[] {
  const needle = /dist[\\/]+cli\.js$/i;
  // 1) Explicit cli.js path in argv: strip everything up to & including it.
  const cliIndex = argv.findIndex((item) => needle.test(item));
  if (cliIndex >= 0) return argv.slice(cliIndex + 1);
  // 2) Neither pattern matched — standard "node script.js" or "1688" bin.
  return argv.slice(2);
}
