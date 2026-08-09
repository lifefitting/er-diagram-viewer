import { describe, expect, it } from 'vitest';
import { resolveStartupView } from './startupState';

describe('startup workspace state', () => {
  it('never shows the empty guide before hydration and startup restore complete', () => {
    expect(
      resolveStartupView({ hydrated: false, startupComplete: false, rawSql: '', tableCount: 0 }),
    ).toBe('loading');
    expect(
      resolveStartupView({ hydrated: true, startupComplete: false, rawSql: '', tableCount: 0 }),
    ).toBe('loading');
  });

  it('shows the guide only for a genuinely empty hydrated session', () => {
    expect(
      resolveStartupView({ hydrated: true, startupComplete: true, rawSql: '  ', tableCount: 0 }),
    ).toBe('empty');
  });

  it('prefers a restored workspace over onboarding', () => {
    expect(
      resolveStartupView({
        hydrated: true,
        startupComplete: true,
        rawSql: 'CREATE TABLE users (id INT);',
        tableCount: 1,
      }),
    ).toBe('workspace');
  });

  it('keeps persisted but invalid SQL in recovery instead of loading a sample', () => {
    expect(
      resolveStartupView({
        hydrated: true,
        startupComplete: true,
        rawSql: 'CREATE TABLE broken',
        tableCount: 0,
      }),
    ).toBe('recovery');
  });
});
