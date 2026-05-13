// Submit feedback / report a bug. Builds a pre-filled GitHub issue URL
// with diagnostic context auto-attached, then opens it in the user's
// browser (TTY) or prints it for the agent to relay (non-TTY / JSON).
//
// Diagnostic info is **anonymized**: version, Node version, OS, platform,
// optional last error message from daemon.log. No user account info,
// no cookies, no profile contents.

import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import { emit, info } from '../io/output.js';
import { CliError } from '../io/errors.js';
import { daemonLogFile } from '../session/paths.js';
import pkg from '../../package.json' with { type: 'json' };

const ISSUES_URL = 'https://github.com/superjack2050/1688-cli/issues/new';

export interface FeedbackOpts {
  message?: string;
  bug?: boolean;
  open?: boolean;
}

export interface FeedbackResult {
  url: string;
  title: string;
  bodyPreview: string;
}

async function readLastDaemonError(): Promise<string | null> {
  try {
    const txt = await fs.readFile(daemonLogFile(), 'utf8');
    // Grab the most recent line starting with "unexpected:" or "Error:".
    const lines = txt.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i] ?? '';
      if (/unexpected:|Error:|EACCES|ENOENT|EOTP/.test(l)) {
        return l.slice(0, 400);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function run(opts: FeedbackOpts): Promise<void> {
  const msg = (opts.message ?? '').trim();
  if (!msg) {
    throw new CliError(
      2,
      'BAD_INPUT',
      'Provide a feedback message:\n  1688 feedback "<your message>"\n  1688 feedback --bug "<bug description>"',
    );
  }

  const lastErr = await readLastDaemonError();
  const isBug = !!opts.bug;
  const title = (isBug ? '[bug] ' : '[feedback] ') + msg.slice(0, 80);
  const body = [
    isBug ? '### Bug report' : '### Feedback',
    '',
    msg,
    '',
    '### Environment',
    `- 1688-cli: ${pkg.version}`,
    `- Node: ${process.version}`,
    `- OS: ${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    lastErr ? `\n### Last daemon error (auto-attached)\n\`\`\`\n${lastErr}\n\`\`\`` : '',
    '',
    '_(submitted via `1688 feedback`)_',
  ]
    .filter(Boolean)
    .join('\n');

  const url =
    ISSUES_URL +
    '?title=' +
    encodeURIComponent(title) +
    '&body=' +
    encodeURIComponent(body);

  // Try to open the browser when on a TTY and the user didn't opt-out.
  // In JSON / agent mode, just emit the URL — the agent can show it.
  const shouldOpen = opts.open !== false && process.stdout.isTTY;
  if (shouldOpen) {
    info('Opening GitHub issue page in your browser...');
    openInBrowser(url);
  }

  emit({
    human: () => {
      process.stdout.write(`Feedback prepared.\n`);
      process.stdout.write(`  title: ${title}\n`);
      process.stdout.write(`  url:   ${url}\n`);
      if (!shouldOpen) {
        process.stdout.write(
          `\nOpen the URL above in a browser and click "Submit new issue" to send.\n`,
        );
      }
    },
    data: {
      url,
      title,
      bodyPreview: body.slice(0, 200),
    } satisfies FeedbackResult,
  });
}

function openInBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    /* Best-effort. URL is still shown in stdout. */
  }
}
