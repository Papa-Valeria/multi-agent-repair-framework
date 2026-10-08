import { describe, expect, it } from '@jest/globals';
import {
  getActiveFrameworkOverheadPct,
  getEndToEndOverheadPct,
  getFrameworkDurationMs
} from '../src/telemetry/AnalyticsMetrics.js';

describe('Research analytics overhead formula', () => {
  it('distinguishes end-to-end overhead from CPU share of active framework time', () => {
    const telemetry = {
      totalDurationMs: 10_000,
      inferenceDurationMs: 6_000,
      oracleDurationMs: 2_000,
      orchestrationOverheadMs: 100
    };

    expect(getFrameworkDurationMs(telemetry)).toBe(2_000);
    expect(getEndToEndOverheadPct(telemetry)).toBe(1);
    expect(getActiveFrameworkOverheadPct(telemetry)).toBe(5);
  });

  it('returns null when there is no framework wall time to measure', () => {
    const telemetry = {
      totalDurationMs: 8_000,
      inferenceDurationMs: 6_000,
      oracleDurationMs: 2_000,
      orchestrationOverheadMs: 100
    };

    expect(getFrameworkDurationMs(telemetry)).toBe(0);
    expect(getEndToEndOverheadPct(telemetry)).toBe(1.25);
    expect(getActiveFrameworkOverheadPct(telemetry)).toBeNull();
  });
});
