// Wire protocol for the 1688 daemon. Newline-delimited JSON over a Unix socket
// on macOS/Linux or a named pipe on Windows.

export interface Request {
  id: string;
  cmd: string;
  args: unknown;
}

export interface OkResponse {
  id: string;
  ok: true;
  data: unknown;
}

export interface ErrResponse {
  id: string;
  ok: false;
  exitCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type Response = OkResponse | ErrResponse;

export function makeRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
