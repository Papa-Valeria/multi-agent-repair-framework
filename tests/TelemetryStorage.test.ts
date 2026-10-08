import { afterEach, describe, expect, it } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkbenchSessionState } from '../src/types/domain.js';
import { ExperimentModelConfig } from '../src/types/analytics.js';
import { TelemetryStorage } from '../src/telemetry/TelemetryStorage.js';

const temporaryDirectories: string[] = [];

async function createStorage(): Promise<TelemetryStorage> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telemetry-storage-test-'));
  temporaryDirectories.push(directory);
  return new TelemetryStorage(directory);
}

function createSession(taskId: string, status: 'FAILED' | 'CONVERGED', iterationsCount: number): WorkbenchSessionState {
  const iterations = Array.from({ length: iterationsCount }, (_, index) => ({
    iteration: index + 1,
    patchDiff: '--- a/service.py\n+++ b/service.py\n@@ -1 +1 @@\n-old\n+new',
    patchHash: `hash-${index}`,
    isApplicable: true,
    verification: {
      verified: status === 'CONVERGED' && index === iterationsCount - 1,
      sastFindings: [],
      semgrepDurationMs: 20,
      testReport: {
        exitCode: status === 'CONVERGED' && index === iterationsCount - 1 ? 0 : 1,
        suitePassed: status === 'CONVERGED' && index === iterationsCount - 1,
        timedOut: false,
        oracleFailed: false,
        totalTests: 4,
        passedTests: status === 'CONVERGED' && index === iterationsCount - 1 ? 4 : 3,
        failedTests: status === 'CONVERGED' && index === iterationsCount - 1 ? 0 : 1,
        skippedTests: 0,
        xfailedTests: 0,
        errorTests: 0,
        passRate: status === 'CONVERGED' && index === iterationsCount - 1 ? 1 : 0.75,
        durationMs: 50,
        failureDetails: [],
        stdout: status === 'CONVERGED' && index === iterationsCount - 1
          ? '4 passed in 0.1s'
          : '3 passed, 1 failed in 0.1s',
        stderr: '',
        executionDurationMs: 50
      }
    },
    telemetry: {
      promptTokens: 100 * (index + 1),
      completionTokens: 40 * (index + 1),
      inferenceDurationMs: 250 * (index + 1),
      oracleDurationMs: 70 * (index + 1),
      orchestrationOverheadMs: 10 * (index + 1),
      totalDurationMs: 500 * (index + 1),
      agentUsage: {
        CODER: { promptTokens: 100, completionTokens: 40, inferenceDurationMs: 250 },
        REVIEWER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 }
      }
    },
    agentUsage: {
      CODER: { promptTokens: 100, completionTokens: 40, inferenceDurationMs: 250 },
      REVIEWER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 }
    },
    patchChanges: { addedLines: 1, deletedLines: 1 },
    applyMode: 'GIT' as const
  }));

  return {
    taskId,
    issueSpec: 'repair issue',
    status,
    targetFiles: ['service.py'],
    currentIteration: iterationsCount,
    maxIterations: 3,
    iterations,
    finalPatch: iterations.at(-1)?.patchDiff,
    cumulativeTelemetry: {
      promptTokens: 100 * iterationsCount,
      completionTokens: 40 * iterationsCount,
      inferenceDurationMs: 250 * iterationsCount,
      oracleDurationMs: 70 * iterationsCount,
      orchestrationOverheadMs: 10 * iterationsCount,
      totalDurationMs: 500 * iterationsCount,
      agentUsage: {
        CODER: { promptTokens: 100 * iterationsCount, completionTokens: 40 * iterationsCount, inferenceDurationMs: 250 * iterationsCount },
        REVIEWER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 }
      }
    }
  };
}

const modelConfig: ExperimentModelConfig = {
  baseUrl: 'http://127.0.0.1:11434/v1',
  modelName: 'qwen2.5-coder:7b',
  seed: 42,
  temperature: 0,
  topP: 1
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('TelemetryStorage', () => {
  it('persists runs and derives paired metrics from stored JSON artifacts', async () => {
    const storage = await createStorage();
    const baselineRunId = await storage.saveRun(createSession('BENCH-01', 'FAILED', 1), 'BASELINE', modelConfig, 'REPAIR', {
      'service.py': 'def authenticate(token): return False\n'
    });
    const multiRunId = await storage.saveRun(createSession('BENCH-01', 'CONVERGED', 2), 'MULTI_AGENT', modelConfig, 'REPAIR');

    const baseline = await storage.getRun(baselineRunId);
    const history = await storage.listRuns({ mode: 'MULTI_AGENT', category: 'REPAIR' });
    const baselineHistory = await storage.listRuns({ mode: 'BASELINE', category: 'REPAIR' });
    const aggregate = await storage.getAggregatedMetrics();
    const comparison = await storage.compareTask('BENCH-01');

    expect(baseline?.targetSources['service.py']).toContain('return False');
    expect(history).toHaveLength(1);
    expect(history[0]?.metrics.testPassRatePct).toBe(100);
    expect(baselineHistory[0]?.metrics.testPassRatePct).toBe(75);
    expect(history[0]?.metrics.coderPromptTokens).toBe(200);
    expect(history[0]?.metrics.reviewerPromptTokens).toBe(0);
    expect(aggregate.modes.BASELINE.successRatePct).toBe(0);
    expect(aggregate.modes.MULTI_AGENT.successRatePct).toBe(100);
    expect(aggregate.autonomousRecoveryRatePct).toBe(100);
    expect(aggregate.pairedTasks[0]?.recoveredAfterRefinement).toBe(true);
    expect(comparison.multiAgent?.metadata.runId).toBe(multiRunId);
    expect(comparison.multiAgent?.metadata.frameworkDurationMs).toBe(360);
    expect(comparison.multiAgent?.metadata.endToEndOverheadPct).toBe(2);
    expect(comparison.multiAgent?.metadata.activeFrameworkOverheadPct).toBeCloseTo(100 / 18, 5);
    expect(comparison.multiAgent?.metadata.orchestrationOverheadBasis).toBe('NODE_PROCESS_CPU');
  });

  it('updates the stored artifact after an HITL approval', async () => {
    const storage = await createStorage();
    const session = createSession('BENCH-02', 'CONVERGED', 1);
    const runId = await storage.saveRun(session, 'MULTI_AGENT', modelConfig);

    await storage.updateRun(runId, {
      ...session,
      status: 'APPROVED',
      approvalCommitHash: 'commit-123',
      isHumanAugmented: true
    });

    const stored = await storage.getRun(runId);
    expect(stored?.session.approvalCommitHash).toBe('commit-123');
    expect(stored?.metadata.status).toBe('APPROVED');
    expect(stored?.metadata.isHumanAugmented).toBe(true);
  });

  it('does not pair runs with different endpoint or sampling configuration', async () => {
    const storage = await createStorage();
    await storage.saveRun(createSession('BENCH-PAIR', 'FAILED', 1), 'BASELINE', modelConfig);
    await storage.saveRun(
      createSession('BENCH-PAIR', 'CONVERGED', 2),
      'MULTI_AGENT',
      { ...modelConfig, baseUrl: 'http://127.0.0.1:8000/v1', seed: 99 }
    );

    const comparison = await storage.compareTask('BENCH-PAIR');
    const aggregate = await storage.getAggregatedMetrics();

    expect(comparison.baseline).toBeNull();
    expect(comparison.multiAgent).toBeNull();
    expect(aggregate.pairedTasks.some((pair) => pair.taskId === 'BENCH-PAIR')).toBe(false);
  });

  it('recomputes both overhead metrics when loading a legacy artifact', async () => {
    const storage = await createStorage();
    const runId = await storage.saveRun(createSession('BENCH-03', 'CONVERGED', 1), 'MULTI_AGENT', modelConfig);
    const directory = temporaryDirectories.at(-1)!;
    const filename = (await fs.readdir(directory)).find((name) => name.endsWith('.json'))!;
    const artifact = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8')) as {
      metadata: Record<string, unknown>;
      session: { cumulativeTelemetry: Record<string, unknown> };
    };
    delete artifact.metadata.endToEndOverheadPct;
    delete artifact.metadata.activeFrameworkOverheadPct;
    delete artifact.session.cumulativeTelemetry.oracleDurationMs;
    delete artifact.session.cumulativeTelemetry.agentUsage;
    await fs.writeFile(path.join(directory, filename), JSON.stringify(artifact), 'utf8');

    const replay = await storage.getRun(runId);

    expect(replay?.metadata.endToEndOverheadPct).toBe(2);
    expect(replay?.metadata.activeFrameworkOverheadPct).toBeCloseTo(100 / 18, 5);
    expect(replay?.session.cumulativeTelemetry.agentUsage.CODER.promptTokens).toBe(100);
  });

  it('downgrades a legacy CONVERGED run when its raw pytest report contains skipped tests', async () => {
    const storage = await createStorage();
    const session = createSession('BENCH-04', 'CONVERGED', 1);
    const runId = await storage.saveRun(session, 'MULTI_AGENT', modelConfig);
    const directory = temporaryDirectories.at(-1)!;
    const filename = (await fs.readdir(directory)).find((name) => name.endsWith('.json'))!;
    const artifact = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8')) as {
      session: {
        iterations: Array<{
          verification: {
            verified: boolean;
            testReport: Record<string, unknown>;
          };
        }>;
      };
    };
    const report = artifact.session.iterations[0]!.verification.testReport;
    artifact.session.iterations[0]!.verification.verified = true;
    report.stdout = '3 passed, 1 skipped in 0.12s';
    delete report.exitCode;
    delete report.skippedTests;
    delete report.xfailedTests;
    delete report.errorTests;
    delete report.passRate;
    await fs.writeFile(path.join(directory, filename), JSON.stringify(artifact), 'utf8');

    const replay = await storage.getRun(runId);
    const history = await storage.listRuns();

    expect(replay?.session.status).toBe('FAILED');
    expect(replay?.session.iterations[0]?.verification.verified).toBe(false);
    expect(replay?.session.iterations[0]?.verification.testReport.skippedTests).toBe(1);
    expect(replay?.session.iterations[0]?.verification.testReport.suitePassed).toBe(false);
    expect(history[0]?.metadata.resolutionVerified).toBe(false);
  });
});
