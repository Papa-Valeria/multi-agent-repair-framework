import { jest } from '@jest/globals';

import { RefinementFSM } from '../src/orchestration/RefinementFSM.js';
import type { InitialContextParams } from '../src/orchestration/ContextBuilder.js';
import type {
  OracleResult,
  ReviewerReviewResult,
  TestExecutionReport
} from '../src/types/domain.js';
import type { ExperimentLimits } from '../src/types/analytics.js';
import type { GitManager } from '../src/git/GitManager.js';
import type { SemgrepEngine } from '../src/verification/SemgrepEngine.js';
import type { TestHarness } from '../src/verification/TestHarness.js';
import type { BuildSyntaxOracle } from '../src/verification/BuildSyntaxOracle.js';
import type { CoderAgent } from '../src/agents/CoderAgent.js';
import type { ReviewerAgent } from '../src/agents/ReviewerAgent.js';
import type { ContextBuilder } from '../src/orchestration/ContextBuilder.js';
import type { TelemetryTracker } from '../src/telemetry/TelemetryTracker.js';

type MockedDependencies = {
  readonly gitManager: GitManager;
  readonly semgrep: SemgrepEngine;
  readonly testHarness: TestHarness;
  readonly buildSyntaxOracle: BuildSyntaxOracle;
  readonly coder: CoderAgent;
  readonly reviewer: ReviewerAgent;
  readonly contextBuilder: ContextBuilder;
  readonly telemetryTracker: TelemetryTracker;
};

const PATCH = [
  'diff --git a/src/example.ts b/src/example.ts',
  'index 1111111..2222222 100644',
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1 +1 @@',
  '-export const value = 1;',
  '+export const value = 2;'
].join('\n');

const PARAMS: InitialContextParams = {
  issueSpec: 'Correggere il valore esportato.',
  category: 'REPAIR',
  targetFiles: ['src/example.ts'],
  testFiles: ['tests/example.test.ts']
};

const LIMITS: ExperimentLimits = {
  maxIterations: 2,
  maxTechnicalAttempts: 1
};

const EMPTY_TEST_REPORT: TestExecutionReport = {
  oracleStatus: 'PASS',
  command: 'pytest',
  args: [],
  cwd: '.',
  timeoutMs: 30_000,
  envAllowList: [],
  oracleFilesExecuted: ['tests/example.test.ts'],
  implicitDiscoveryUsed: false,
  expectedExitPolicy: {
    passExitCodes: [0],
    failExitCodes: [1],
    executionErrorExitCodes: []
  },
  exitCode: 0,
  suitePassed: true,
  timedOut: false,
  oracleFailed: false,
  totalTests: 1,
  passedTests: 1,
  failedTests: 0,
  skippedTests: 0,
  xfailedTests: 0,
  xpassedTests: 0,
  errorTests: 0,
  passRate: 1,
  durationMs: 2,
  failureDetails: [],
  stdout: '1 passed',
  stderr: '',
  rawStdout: '1 passed',
  rawStderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
  executionDurationMs: 2
};

const APPLICABILITY_PASS: OracleResult<'APPLICABILITY'> = {
  oracle: 'APPLICABILITY',
  status: 'PASS',
  required: true,
  durationMs: 1,
  summary: 'Patch applicabile.',
  evidence: {
    applyMode: 'GIT',
    patchHash: 'patch-hash'
  }
};

const BUILD_PASS: OracleResult<'BUILD_SYNTAX'> = {
  oracle: 'BUILD_SYNTAX',
  status: 'PASS',
  required: true,
  durationMs: 1,
  summary: 'Build valida.',
  evidence: {
    command: 'npm',
    args: ['test'],
    cwd: '.',
    timeoutMs: 30_000,
    envAllowList: [],
    exitCode: 0,
    timedOut: false,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false
  }
};

const SEMGREP_FAIL: OracleResult<'SEMGREP'> = {
  oracle: 'SEMGREP',
  status: 'FAIL',
  required: true,
  durationMs: 1,
  summary: 'Finding residuo.',
  evidence: {
    findings: [
      {
        ruleId: 'test.rule',
        path: 'src/example.ts',
        startLine: 1,
        endLine: 1,
        severity: 'ERROR',
        message: 'Finding residuo.'
      }
    ],
    scannedFiles: ['src/example.ts']
  }
};

const FUNCTIONAL_PASS: OracleResult<'FUNCTIONAL_TEST'> = {
  oracle: 'FUNCTIONAL_TEST',
  status: 'PASS',
  required: true,
  durationMs: 2,
  summary: 'Test passati.',
  evidence: {
    report: EMPTY_TEST_REPORT
  }
};

const TELEMETRY_SNAPSHOT = {
  promptTokens: null,
  completionTokens: null,
  tokenUsageAvailable: false,
  inferenceDurationMs: 0,
  oracleDurationMs: 0,
  orchestrationOverheadMs: 0,
  totalDurationMs: 0,
  agentUsage: {
    CODER: {
      promptTokens: null,
      completionTokens: null,
      tokenUsageAvailable: false,
      inferenceDurationMs: 0
    },
    REVIEWER: {
      promptTokens: null,
      completionTokens: null,
      tokenUsageAvailable: false,
      inferenceDurationMs: 0
    }
  }
} as const;

function createDependencies(): MockedDependencies {
  const gitManager = {
    getHead: jest.fn(async () => 'initial-head'),
    assertWorkingTreeClean: jest.fn(async () => undefined),
    computePatchHash: jest.fn(() => 'patch-hash'),
    evaluateApplicability: jest.fn(async () => APPLICABILITY_PASS),
    normalizeRejectedPatch: jest.fn(async () => null),
    applyPatch: jest.fn(async () => 'GIT' as const),
    rollback: jest.fn(async () => ({
      status: 'SUCCESS' as const,
      initialHead: 'initial-head',
      finalHead: 'initial-head',
      repositoryClean: true,
      workingTreeStatus: ''
    }))
  } as unknown as GitManager;

  const semgrep = {
    evaluate: jest.fn(async () => SEMGREP_FAIL)
  } as unknown as SemgrepEngine;

  const testHarness = {
    evaluate: jest.fn(async () => FUNCTIONAL_PASS)
  } as unknown as TestHarness;

  const buildSyntaxOracle = {
    evaluate: jest.fn(async () => BUILD_PASS)
  } as unknown as BuildSyntaxOracle;

  const coder = {
    generatePatch: jest.fn(async () => PATCH)
  } as unknown as CoderAgent;

  const reviewer = {
    review: jest.fn(async (): Promise<ReviewerReviewResult> => ({
      reviewerMode: 'LLM',
      feedback: {
        rootCauseSummary: 'Finding residuo.',
        violationsPrunedCount: 0,
        targetRemediations: [],
        securityPriorityStrict: true,
        flappingDetected: false
      }
    }))
  } as unknown as ReviewerAgent;

  const contextBuilder = {
    buildInitialPayload: jest.fn(async () => 'initial payload'),
    buildTechnicalRetryPayload: jest.fn(() => 'technical retry payload'),
    buildRefinementPayload: jest.fn(() => 'refinement payload')
  } as unknown as ContextBuilder;

  const telemetryTracker = {
    startIteration: jest.fn(),
    startCpuMeasurement: jest.fn(() => ({
      user: 0,
      system: 0
    })),
    recordOrchestrationCpu: jest.fn(),
    recordOracleDuration: jest.fn(),
    getSnapshot: jest.fn(() => TELEMETRY_SNAPSHOT),
    getIterationAgentUsage: jest.fn(() => TELEMETRY_SNAPSHOT.agentUsage)
  } as unknown as TelemetryTracker;

  return {
    gitManager,
    semgrep,
    testHarness,
    buildSyntaxOracle,
    coder,
    reviewer,
    contextBuilder,
    telemetryTracker
  };
}

function createFsm(
  dependencies: MockedDependencies
): RefinementFSM {
  return new RefinementFSM(
    'BE-P1-22-test-task',
    dependencies.gitManager,
    dependencies.semgrep,
    dependencies.testHarness,
    dependencies.buildSyntaxOracle,
    dependencies.coder,
    dependencies.reviewer,
    dependencies.contextBuilder,
    dependencies.telemetryTracker,
    LIMITS
  );
}

function expectStructuredTerminalFailure(
  state: Awaited<ReturnType<RefinementFSM['runBaseline']>>,
  expected: {
    readonly phase: string;
    readonly category: string;
    readonly message: string;
    readonly oracle?: string;
  }
): void {
  expect(state.status).toBeDefined();
  expect(state.autonomousStatus).toBe(state.status);
  expect([
    'FAILED',
    'INFRASTRUCTURE_ERROR',
    'UNRESOLVED'
  ]).toContain(state.status);
  expect(state.finalizationStatus).toBe('NOT_FINALIZED');
  expect(state.candidateVerified).toBe(false);
  expect(state.autonomousRunSucceeded).toBe(false);
  expect(state.failure).toEqual(
    expect.objectContaining({
      phase: expected.phase,
      category: expected.category,
      message: expect.stringContaining(expected.message),
      recoverable: false,
      iteration: 1,
      ...(expected.oracle !== undefined
        ? { oracle: expected.oracle }
        : {})
    })
  );
  expect(state.terminationReason).toEqual(expect.any(String));
  expect(state.terminationReason?.length).toBeGreaterThan(0);
  expect(state.iterations).toHaveLength(1);
  expect(state.iterations[0]?.failure).toEqual(state.failure);
}

describe('BE-P1-22 - RefinementFSM failure boundaries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runBaseline converte l’eccezione di computePatchHash in uno stato terminale strutturato', async () => {
    const dependencies = createDependencies();

    jest
      .spyOn(dependencies.gitManager, 'computePatchHash')
      .mockImplementation(() => {
        throw new Error('hash failure');
      });

    const fsm = createFsm(dependencies);

    const promise = fsm.runBaseline(PARAMS);

    await expect(promise).resolves.toBeDefined();

    const state = await promise;

    expectStructuredTerminalFailure(state, {
      phase: 'PATCH_VALIDATION',
      category: 'INFRASTRUCTURE_FAILURE',
      message: 'hash failure'
    });

    expect(dependencies.gitManager.evaluateApplicability).not.toHaveBeenCalled();
  });

  it('runBaseline converte l’eccezione di evaluateApplicability in ORACLE_EXECUTION_FAILURE', async () => {
    const dependencies = createDependencies();

    jest
      .spyOn(dependencies.gitManager, 'evaluateApplicability')
      .mockRejectedValue(new Error('applicability failure'));

    const fsm = createFsm(dependencies);
    const state = await fsm.runBaseline(PARAMS);

    expectStructuredTerminalFailure(state, {
      phase: 'PATCH_VALIDATION',
      category: 'ORACLE_EXECUTION_FAILURE',
      message: 'applicability failure',
      oracle: 'APPLICABILITY'
    });
  });

  it('runLoop converte un risultato Reviewer assente in REVIEWER_FAILURE senza rigettare', async () => {
    const dependencies = createDependencies();

    jest
      .spyOn(dependencies.reviewer, 'review')
      .mockResolvedValue(
        undefined as unknown as ReviewerReviewResult
      );

    const fsm = createFsm(dependencies);
    const state = await fsm.runLoop(PARAMS);

    expect(state.status).toBeDefined();
    expect(state.autonomousStatus).toBe(state.status);
    expect(state.finalizationStatus).toBe('NOT_FINALIZED');
    expect(state.candidateVerified).toBe(false);
    expect(state.autonomousRunSucceeded).toBe(false);
    expect(state.failure).toEqual(
      expect.objectContaining({
        phase: 'REVIEW',
        category: 'REVIEWER_FAILURE',
        message: expect.stringContaining('risultato Reviewer assente'),
        recoverable: false,
        iteration: 1
      })
    );
    expect(state.terminationReason).toEqual(expect.any(String));
    expect(state.terminationReason?.length).toBeGreaterThan(0);
    expect(state.iterations).toHaveLength(1);
    expect(state.iterations[0]?.failure).toEqual(state.failure);
    expect(dependencies.gitManager.rollback).toHaveBeenCalledWith('initial-head');
  });
});
