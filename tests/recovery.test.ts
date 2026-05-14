import { describe, expect, it } from 'vitest';
import { CliError } from '../src/io/errors.js';
import {
  classifyRecoveryFailure,
  recoveryDecisionFor,
  type RecoveryFailureSignals,
} from '../src/session/recovery.js';
import type { PageState } from '../src/session/page-state.js';

function trace(overrides: Partial<RecoveryFailureSignals['trace']> = {}): RecoveryFailureSignals['trace'] {
  return {
    console: [],
    pageErrors: [],
    network: {
      recent: [],
      failed: [],
      httpErrors: [],
    },
    ...overrides,
  };
}

function pageState(kind: PageState['kind']): PageState {
  return {
    kind,
    url: 'https://s.1688.com/selloffer/offer_search.htm',
    title: null,
    indicators: [],
  };
}

function signals(input: Partial<RecoveryFailureSignals>): RecoveryFailureSignals {
  return {
    message: '',
    pageState: null,
    trace: trace(),
    ...input,
  };
}

describe('classifyRecoveryFailure', () => {
  it('classifies login and risk states before generic errors', () => {
    expect(
      classifyRecoveryFailure(
        signals({ message: 'selector not found', pageState: pageState('not_logged_in') }),
      ),
    ).toBe('not_logged_in');

    expect(
      classifyRecoveryFailure(
        signals({ message: 'selector not found', pageState: pageState('risk_challenge') }),
      ),
    ).toBe('risk_challenge');
  });

  it('classifies rate limiting from page state, message, and network status', () => {
    expect(
      classifyRecoveryFailure(signals({ pageState: pageState('rate_limited') })),
    ).toBe('rate_limited');

    expect(
      classifyRecoveryFailure(signals({ message: 'HTTP 429 Too Many Requests' })),
    ).toBe('rate_limited');

    expect(
      classifyRecoveryFailure(
        signals({
          trace: trace({
            network: {
              recent: [],
              failed: [],
              httpErrors: [{ status: 429 }],
            },
          }),
        }),
      ),
    ).toBe('rate_limited');
  });

  it('classifies browser context, network, navigation, and element failures', () => {
    expect(
      classifyRecoveryFailure(signals({ message: 'Target page, context or browser has been closed' })),
    ).toBe('browser_context_broken');

    expect(
      classifyRecoveryFailure(signals({ message: 'net::ERR_TIMED_OUT' })),
    ).toBe('network_error');

    expect(
      classifyRecoveryFailure(signals({ message: 'Navigation timeout of 30000 ms exceeded' })),
    ).toBe('navigation_timeout');

    expect(
      classifyRecoveryFailure(signals({ message: 'element does not receive pointer events' })),
    ).toBe('element_blocked');

    expect(
      classifyRecoveryFailure(signals({ message: 'locator("button").first() not found' })),
    ).toBe('element_missing');
  });

  it('classifies repeated network failures and likely site changes', () => {
    expect(
      classifyRecoveryFailure(
        signals({
          trace: trace({
            network: {
              recent: [],
              failed: [{}, {}, {}],
              httpErrors: [],
            },
          }),
        }),
      ),
    ).toBe('network_error');

    expect(
      classifyRecoveryFailure(
        signals({
          message: 'PREVIEW_PARSE_FAILED: expected preview data',
          pageState: pageState('normal_1688_page'),
        }),
      ),
    ).toBe('site_changed');
  });

  it('falls back to unknown when no signal matches', () => {
    expect(classifyRecoveryFailure(signals({ message: 'something odd happened' }))).toBe(
      'unknown',
    );
  });
});

describe('recoveryDecisionFor', () => {
  it('does not retry login, risk challenge, or site changes', () => {
    expect(recoveryDecisionFor('not_logged_in', false)).toMatchObject({
      retryable: false,
      maxRetries: 0,
      action: 'pause_for_manual_login',
      exitCode: 3,
    });

    expect(recoveryDecisionFor('risk_challenge', false)).toMatchObject({
      retryable: false,
      maxRetries: 0,
      action: 'pause_for_manual_challenge',
      exitCode: 4,
    });

    expect(recoveryDecisionFor('site_changed', false)).toMatchObject({
      retryable: false,
      maxRetries: 0,
      action: 'fail_with_artifacts',
    });
  });

  it('allows one retry for transient failures', () => {
    for (const kind of [
      'rate_limited',
      'element_missing',
      'element_blocked',
      'navigation_timeout',
      'browser_context_broken',
      'network_error',
      'unknown',
    ] as const) {
      expect(recoveryDecisionFor(kind, false)).toMatchObject({
        retryable: true,
        maxRetries: 1,
      });
    }
  });

  it('does not add cooldown for headed risk challenge', () => {
    expect(recoveryDecisionFor('risk_challenge', true).cooldownMs).toBe(0);
    expect(recoveryDecisionFor('risk_challenge', false).cooldownMs).toBeGreaterThan(0);
  });

  it('preserves non-retry policy for commands that pass maxRetries 0', () => {
    const decision = recoveryDecisionFor('network_error', false);
    const configuredRetries = 0;
    const allowedRetries = Math.min(configuredRetries, decision.maxRetries);
    const willRetry = decision.retryable && 0 < allowedRetries;

    expect(decision.retryable).toBe(true);
    expect(allowedRetries).toBe(0);
    expect(willRetry).toBe(false);
  });

  it('classifies CliError codes used by checkout and seller-chat diagnostics', () => {
    const checkoutError = new CliError(
      21,
      'SUBMIT_BUTTON_NOT_FOUND',
      'Could not find "提交订单" element on preview page.',
    );
    expect(
      classifyRecoveryFailure(
        signals({ message: checkoutError.message, code: checkoutError.code }),
      ),
    ).toBe('element_missing');

    const chatError = new CliError(
      24,
      'SEND_UNCONFIRMED',
      'Send clicked but neither input cleared nor message appeared in scrollback.',
    );
    expect(
      classifyRecoveryFailure(signals({ message: chatError.message, code: chatError.code })),
    ).toBe('unknown');
  });
});
