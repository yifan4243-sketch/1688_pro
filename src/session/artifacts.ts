import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { CliError, type CliErrorDetails } from '../io/errors.js';
import { runsDir } from './paths.js';
import { detectPageState, recoverHintForPageState } from './page-state.js';

export interface RunMeta {
  requestId?: string;
  cmd: string;
  args: unknown;
}

interface ErrorShape {
  code?: string;
  message: string;
  stack?: string;
}

function errorShape(e: unknown): ErrorShape {
  if (e instanceof CliError) {
    return { code: e.code, message: e.message, stack: e.stack };
  }
  if (e instanceof Error) {
    return { message: e.message, stack: e.stack };
  }
  return { message: String(e) };
}

function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'command';
}

function pickPage(ctx: BrowserContext): Page | null {
  const pages = ctx.pages().filter((p) => !p.isClosed());
  return pages.at(-1) ?? null;
}

function requestId(meta: RunMeta): string {
  return (
    meta.requestId ??
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName(meta.cmd)}`
  );
}

function categoryForPageState(kind: string): string | undefined {
  switch (kind) {
    case 'not_logged_in':
      return 'auth';
    case 'risk_challenge':
      return 'risk';
    case 'rate_limited':
      return 'rate_limit';
    case 'unknown':
      return 'unknown_page_state';
    default:
      return undefined;
  }
}

export async function captureFailureArtifact(
  ctx: BrowserContext,
  meta: RunMeta,
  error: unknown,
): Promise<CliErrorDetails> {
  const id = requestId(meta);
  const dir = path.join(runsDir(), id);
  await fs.mkdir(dir, { recursive: true });

  const page = pickPage(ctx);
  const pageState = page ? await detectPageState(page).catch(() => null) : null;
  const details: CliErrorDetails = {
    artifactDir: dir,
  };

  if (pageState) {
    details.currentUrl = pageState.url;
    details.pageState = pageState.kind;
    details.category = categoryForPageState(pageState.kind);
    details.recoverHint = recoverHintForPageState(pageState.kind);
    details.retryable =
      pageState.kind === 'rate_limited' || pageState.kind === 'unknown';
  }

  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(dir, 'screenshot.png'), fullPage: true })
      .catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) await fs.writeFile(path.join(dir, 'page.html'), html);
  }

  await fs.writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify(
      {
        requestId: id,
        at: new Date().toISOString(),
        command: meta.cmd,
        args: meta.args,
        error: errorShape(error),
        pageState,
      },
      null,
      2,
    ),
  );

  return details;
}

export async function enrichErrorWithArtifact(
  ctx: BrowserContext,
  meta: RunMeta,
  error: unknown,
): Promise<Error> {
  const details = await captureFailureArtifact(ctx, meta, error).catch(
    () => ({}),
  );
  if (error instanceof CliError) {
    return error.withDetails(details);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError(1, 'INTERNAL', message, details);
}
