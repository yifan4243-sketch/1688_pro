export class CliError extends Error {
  constructor(
    public readonly exitCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
