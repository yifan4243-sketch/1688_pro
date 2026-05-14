import { describe, expect, it } from 'vitest';
import { CliError } from '../src/io/errors.js';
import { locatorCandidateToDebugString } from '../src/session/locator.js';
import { classifyRecoveryFailure } from '../src/session/recovery.js';
import type { LocatorCandidate } from '../src/session/locator.js';
import type { RecoveryFailureSignals } from '../src/session/recovery.js';

function signals(message: string, code?: string): RecoveryFailureSignals {
  return {
    message,
    code,
    pageState: null,
    trace: {
      console: [],
      pageErrors: [],
      network: {
        recent: [],
        failed: [],
        httpErrors: [],
      },
    },
  };
}

describe('locatorCandidateToDebugString', () => {
  it('formats role, text, and css candidates for artifact details', () => {
    const candidates: LocatorCandidate[] = [
      { kind: 'role', role: 'button', name: /^删除$/ },
      { kind: 'text', text: '结算' },
      { kind: 'css', selector: 'button:has-text("确认")' },
      { kind: 'css', selector: 'q-button:has-text("提交订单")' },
    ];

    expect(candidates.map(locatorCandidateToDebugString)).toEqual([
      'role=button name=/^删除$/',
      'text=结算',
      'css=button:has-text("确认")',
      'css=q-button:has-text("提交订单")',
    ]);
  });
});

describe('stable locator recovery classification', () => {
  it('maps locator not found errors to element_missing', () => {
    const error = new CliError(
      14,
      'STABLE_LOCATOR_NOT_FOUND',
      'Could not locate cart row checkbox for cartId 123.',
    );

    expect(classifyRecoveryFailure(signals(error.message, error.code))).toBe(
      'element_missing',
    );
  });

  it('maps locator click failures to element_blocked', () => {
    const error = new CliError(
      14,
      'STABLE_LOCATOR_BLOCKED',
      'Located cart checkout button, but it was not clickable: element does not receive pointer events',
    );

    expect(classifyRecoveryFailure(signals(error.message, error.code))).toBe(
      'element_blocked',
    );
  });

  it('maps IM input locator failures to element_missing', () => {
    const error = new CliError(
      22,
      'STABLE_LOCATOR_NOT_FOUND',
      'Could not locate 旺旺 IM chat input.',
    );

    expect(classifyRecoveryFailure(signals(error.message, error.code))).toBe(
      'element_missing',
    );
  });
});
