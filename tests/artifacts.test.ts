import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext } from 'playwright';
import { describe, expect, it } from 'vitest';
import { CliError } from '../src/io/errors.js';
import { captureFailureArtifact } from '../src/session/artifacts.js';

function mockContext(): BrowserContext {
  return {
    pages: () => [],
  } as unknown as BrowserContext;
}

describe('captureFailureArtifact', () => {
  it('persists response capture diagnostics from CliError details', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'bb1688-artifacts-'));
    const previousHome = process.env.BB1688_HOME;
    process.env.BB1688_HOME = home;
    try {
      const responseCapture = {
        timeoutMs: 10,
        startedAt: '2026-05-15T00:00:00.000Z',
        disposed: true,
        settled: false,
        timedOut: true,
        seenCount: 1,
        matchedCount: 1,
        parsedCount: 0,
        emptyResultCount: 0,
        failureCount: 1,
        lastSeenUrl: 'https://example.com/api',
        lastMatchedUrl: 'https://example.com/api',
        failures: [
          {
            at: '2026-05-15T00:00:00.001Z',
            phase: 'parse',
            url: 'https://example.com/api',
            name: 'SyntaxError',
            message: 'Unexpected token',
          },
        ],
        emptyResults: [],
      };
      const error = new CliError(11, 'NO_CART_DATA', 'missing cart data', {
        category: 'response_capture',
        responseCapture,
      });

      const details = await captureFailureArtifact(
        mockContext(),
        { cmd: 'cart-list', args: {} },
        error,
      );

      expect(details.artifactDir).toBeTruthy();
      const artifactDir = details.artifactDir!;
      const responseCaptureFile = JSON.parse(
        await fs.readFile(path.join(artifactDir, 'response-capture.json'), 'utf8'),
      );
      const meta = JSON.parse(
        await fs.readFile(path.join(artifactDir, 'meta.json'), 'utf8'),
      );

      expect(responseCaptureFile).toEqual(responseCapture);
      expect(meta.error.details.responseCapture).toEqual(responseCapture);
    } finally {
      if (previousHome === undefined) {
        delete process.env.BB1688_HOME;
      } else {
        process.env.BB1688_HOME = previousHome;
      }
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
