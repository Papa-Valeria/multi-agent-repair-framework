import { describe, expect, it } from '@jest/globals';
import { TelemetryTracker } from '../src/telemetry/TelemetryTracker.js';

describe('TelemetryTracker', () => {
  it('separates per-role usage, oracle time, and Node CPU overhead by iteration', () => {
    const tracker = new TelemetryTracker();
    tracker.startIteration();
    tracker.recordLLMUsage('CODER', 100, 40, 25);
    tracker.recordLLMUsage('REVIEWER', 30, 10, 15);
    tracker.recordOracleDuration(80);

    const cpuStart = tracker.startCpuMeasurement();
    let checksum = 0;
    for (let index = 0; index < 500_000; index += 1) checksum += Math.sqrt(index);
    tracker.recordOrchestrationCpu(cpuStart);

    const snapshot = tracker.getSnapshot();
    const iterationUsage = tracker.getIterationAgentUsage();

    expect(checksum).toBeGreaterThan(0);
    expect(snapshot.promptTokens).toBe(130);
    expect(snapshot.completionTokens).toBe(50);
    expect(snapshot.oracleDurationMs).toBe(80);
    expect(snapshot.agentUsage.CODER.promptTokens).toBe(100);
    expect(snapshot.agentUsage.REVIEWER.completionTokens).toBe(10);
    expect(iterationUsage.CODER.inferenceDurationMs).toBe(25);
    expect(iterationUsage.REVIEWER.inferenceDurationMs).toBe(15);
    expect(snapshot.orchestrationOverheadMs).toBeGreaterThan(0);

    tracker.startIteration();
    expect(tracker.getIterationAgentUsage().CODER.promptTokens).toBe(0);
    expect(tracker.getSnapshot().agentUsage.CODER.promptTokens).toBe(100);
  });
});
