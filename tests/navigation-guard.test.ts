import { describe, expect, it } from 'vitest';
import { CliError } from '../src/io/errors.js';
import {
  assertSafeNavigation,
  classifyNavigation,
  navigationWarning,
} from '../src/session/navigation-guard.js';

describe('navigation guard', () => {
  it('classifies normal 1688 domains as allowed', () => {
    expect(classifyNavigation('https://detail.1688.com/offer/123.html')).toMatchObject({
      kind: '1688',
      host: 'detail.1688.com',
    });
    expect(navigationWarning('https://cart.1688.com/')).toBeNull();
  });

  it('classifies login, risk, payment, and external URLs', () => {
    expect(classifyNavigation('https://login.taobao.com/member/login.jhtml').kind).toBe('login');
    expect(classifyNavigation('https://punish.1688.com/?x5secdata=abc').kind).toBe('risk_control');
    expect(classifyNavigation('https://cashier.1688.com/pay')).toMatchObject({ kind: 'payment' });
    expect(classifyNavigation('https://example.com/phish')).toMatchObject({ kind: 'external' });
  });

  it('emits warnings for non-allowed read navigation', () => {
    expect(navigationWarning('https://example.com/phish')).toMatchObject({
      code: 'NAVIGATION_EXTERNAL',
      message: 'Navigation reached an unexpected external domain.',
    });
  });

  it('allows read navigation warnings without throwing except payment', () => {
    expect(() => assertSafeNavigation('https://example.com/phish', { write: false })).not.toThrow();
    expect(() => assertSafeNavigation('https://cashier.1688.com/pay', { write: false })).toThrow(CliError);
  });

  it('blocks write navigation outside allowed domains', () => {
    expect(() => assertSafeNavigation('https://example.com/phish', { write: true })).toThrow(
      /unexpected external domain/i,
    );
  });
});
