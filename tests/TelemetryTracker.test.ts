import {
  describe,
  expect,
  it,
  jest
} from '@jest/globals';

import {
  TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

describe('TelemetryTracker', () => {
  it(
    'separates per-role usage, oracle time, and Node CPU overhead by iteration',
    () => {
      const tracker =
        new TelemetryTracker();

      tracker.startRun();
      tracker.startIteration();

      tracker.recordLLMUsage(
        'CODER',
        100,
        40,
        25
      );

      tracker.recordLLMUsage(
        'REVIEWER',
        30,
        10,
        15
      );

      tracker.recordOracleDuration(80);

      const cpuStart =
        tracker.startCpuMeasurement();

      let checksum = 0;

      for (
        let index = 0;
        index < 500_000;
        index += 1
      ) {
        checksum += Math.sqrt(index);
      }

      tracker.recordOrchestrationCpu(
        cpuStart
      );

      const snapshot =
        tracker.getSnapshot();

      const iterationUsage =
        tracker.getIterationAgentUsage();

      expect(checksum)
        .toBeGreaterThan(0);

      expect(snapshot.promptTokens)
        .toBe(130);

      expect(snapshot.completionTokens)
        .toBe(50);

      expect(snapshot.oracleDurationMs)
        .toBe(80);

      expect(
        snapshot.agentUsage
          .CODER.promptTokens
      ).toBe(100);

      expect(
        snapshot.agentUsage
          .REVIEWER.completionTokens
      ).toBe(10);

      expect(
        iterationUsage
          .CODER.inferenceDurationMs
      ).toBe(25);

      expect(
        iterationUsage
          .REVIEWER.inferenceDurationMs
      ).toBe(15);

      expect(
        snapshot.orchestrationOverheadMs
      ).toBeGreaterThan(0);

      expect(
        snapshot.totalDurationMs
      ).toBeGreaterThanOrEqual(0);

      tracker.startIteration();

      expect(
        tracker
          .getIterationAgentUsage()
          .CODER.promptTokens
      ).toBe(0);

      expect(
        tracker
          .getSnapshot()
          .agentUsage
          .CODER.promptTokens
      ).toBe(100);
    }
  );

  it(
    'returns totalDurationMs=0 before the run starts',
    () => {
      const tracker =
        new TelemetryTracker();

      const snapshot =
        tracker.getSnapshot();

      expect(
        snapshot.totalDurationMs
      ).toBe(0);
    }
  );

  it(
    'excludes elapsed time before startRun from totalDurationMs',
    () => {
      const nowSpy = jest
        .spyOn(performance, 'now');

      nowSpy
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(1_250);

      const tracker =
        new TelemetryTracker();

      /*
       * Simula il momento effettivo di
       * avvio della FSM.
       *
       * Il tracker è già stato costruito,
       * ma il wall-clock deve iniziare
       * soltanto qui.
       */
      tracker.startRun();

      const snapshot =
        tracker.getSnapshot();

      expect(
        snapshot.totalDurationMs
      ).toBe(250);

      nowSpy.mockRestore();
    }
  );

  it(
    'measures elapsed time only after startRun',
    () => {
      const nowSpy = jest
        .spyOn(performance, 'now');

      nowSpy
        .mockReturnValueOnce(2_000)
        .mockReturnValueOnce(2_375);

      const tracker =
        new TelemetryTracker();

      tracker.startRun();

      const snapshot =
        tracker.getSnapshot();

      expect(
        snapshot.totalDurationMs
      ).toBe(375);

      nowSpy.mockRestore();
    }
  );

  it(
    'rejects a second startRun call',
    () => {
      const tracker =
        new TelemetryTracker();

      tracker.startRun();

      expect(() =>
        tracker.startRun()
      ).toThrow(
        'La telemetria del run è già stata avviata.'
      );
    }
  );
});
