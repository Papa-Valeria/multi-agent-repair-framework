import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GitManager } from '../src/git/GitManager.js';
import { CoderAgent } from '../src/agents/CoderAgent.js';
import { ReviewerAgent } from '../src/agents/ReviewerAgent.js';
import { ContextBuilder } from '../src/orchestration/ContextBuilder.js';
import { RefinementFSM } from '../src/orchestration/RefinementFSM.js';
import { TelemetryTracker } from '../src/telemetry/TelemetryTracker.js';
import { SemgrepEngine } from '../src/verification/SemgrepEngine.js';
import { ProcessRunner } from '../src/verification/ProcessRunner.js';
import { TestHarness } from '../src/verification/TestHarness.js';
import { TestExecutionReport } from '../src/types/domain.js';

describe('Oracle failures are fail-closed', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects empty Semgrep output even when the process exits successfully', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 1
    });

    await expect(new SemgrepEngine(process.cwd()).scan(['src/example.ts'], 'diff')).rejects.toThrow(
      'non ha prodotto un report JSON'
    );
  });

  it('rejects a Semgrep report when the scanner exits abnormally', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 2,
      stdout: '{"results":[]}',
      stderr: 'scanner error',
      timedOut: false,
      durationMs: 1
    });

    await expect(new SemgrepEngine(process.cwd()).scan(['src/example.ts'], 'diff')).rejects.toThrow(
      'terminato con codice 2'
    );
  });

  it('uses an available security rule-set instead of the removed p/cwe preset', async () => {
    const executeSpy = jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '{"results":[],"errors":[]}',
      stderr: '',
      timedOut: false,
      durationMs: 1
    });

    await new SemgrepEngine(process.cwd()).scan(
      ['service.py'],
      '--- a/service.py\n+++ b/service.py\n@@ -1 +1 @@\n-old\n+new'
    );

    const args = executeSpy.mock.calls[0]?.[1] ?? [];
    expect(args).toContain('--config=p/security-audit');
    expect(args).not.toContain('--config=p/cwe');
  });

  it('reports a runner timeout as a blocking execution failure for refinement', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 30000
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.timedOut).toBe(true);
    expect(report.durationMs).toBe(30000);
    expect(report.failureDetails[0]?.testName).toBe('ExecutionTimeout');
    expect(report.failureDetails[0]?.assertionMessage).toBe('Execution Timeout: execution exceeded 30s threshold');
  });

  it('classifies a missing test-runner executable as an oracle failure', async () => {
    const report = await new TestHarness(process.cwd(), '__missing_test_runner__', []).executeSuite();

    expect(report.oracleFailed).toBe(true);
    expect(report.suitePassed).toBe(false);
    expect(report.oracleFailureReason).toMatch(/Impossibile avviare/);
  });

  it('rejects an empty test-runner result even when the process exits successfully', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      durationMs: 1
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(true);
    expect(report.suitePassed).toBe(false);
  });

  it('keeps assertion failures distinct from runner failures', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 1,
      stdout: 'FAILED test_sample.py::test_case - AssertionError\n1 failed in 0.1s',
      stderr: '',
      timedOut: false,
      durationMs: 100
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.failedTests).toBe(1);
  });

  it('treats Pytest exit code 1 without a valid summary as an oracle failure', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 1,
      stdout: 'AssertionError: expected true, got false',
      stderr: '',
      timedOut: false,
      durationMs: 100
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(true);
    expect(report.suitePassed).toBe(false);
    expect(report.oracleFailureReason).toMatch(/riepilogo dei test valido/i);
  });

  it('parses actual passed, failed, and skipped counts from the Pytest summary', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 1,
      stdout: '3 passed, 1 failed in 0.12s',
      stderr: '',
      timedOut: false,
      durationMs: 420
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.totalTests).toBe(4);
    expect(report.passedTests).toBe(3);
    expect(report.failedTests).toBe(1);
    expect(report.passRate).toBe(0.75);
    expect(report.exitCode).toBe(1);
  });

  it('rejects convergence when every Pytest test was skipped', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '4 skipped in 0.12s',
      stderr: '',
      timedOut: false,
      durationMs: 120
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.totalTests).toBe(4);
    expect(report.passedTests).toBe(0);
    expect(report.skippedTests).toBe(4);
    expect(report.passRate).toBe(0);
  });

  it('blocks convergence when a passing summary contains skipped tests', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '3 passed, 1 skipped in 0.12s',
      stderr: '',
      timedOut: false,
      durationMs: 120
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.totalTests).toBe(4);
    expect(report.passedTests).toBe(3);
    expect(report.skippedTests).toBe(1);
    expect(report.passRate).toBe(0.75);
  });

  it('tracks xfailed separately and never counts it as passed', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '2 passed, 1 xfailed in 0.12s',
      stderr: '',
      timedOut: false,
      durationMs: 120
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.totalTests).toBe(2);
    expect(report.passedTests).toBe(2);
    expect(report.xfailedTests).toBe(1);
    expect(report.passRate).toBe(1);
  });

  it('tracks test errors separately and rejects convergence', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 1,
      stdout: '1 passed, 1 error in 0.12s',
      stderr: '',
      timedOut: false,
      durationMs: 120
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.totalTests).toBe(2);
    expect(report.passedTests).toBe(1);
    expect(report.errorTests).toBe(1);
    expect(report.passRate).toBe(0.5);
  });

  it('converges only when every reported test passed', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 0,
      stdout: '3 passed in 0.12s',
      stderr: '',
      timedOut: false,
      durationMs: 120
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.suitePassed).toBe(true);
    expect(report.totalTests).toBe(3);
    expect(report.passedTests).toBe(3);
    expect(report.passRate).toBe(1);
  });

  it('terminates both baseline and refinement as FAILED when Semgrep throws', async () => {
    const patch = '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new';
    const git = {
      computePatchHash: jest.fn(() => 'hash'),
      dryRunPatch: jest.fn(async () => true),
      applyPatch: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined)
    } as unknown as GitManager;
    const semgrep = {
      scan: jest.fn(async () => {
        throw new Error('Semgrep unavailable');
      })
    } as unknown as SemgrepEngine;
    const testHarness = {
      executeSuite: jest.fn<() => Promise<TestExecutionReport>>()
    } as unknown as TestHarness;
    const coder = {
      generatePatch: jest.fn(async () => patch)
    } as unknown as CoderAgent;
    const reviewer = {
      review: jest.fn()
    } as unknown as ReviewerAgent;
    const contextBuilder = {
      buildInitialPayload: jest.fn(async () => '{}'),
      buildRefinementPayload: jest.fn(() => '{}')
    } as unknown as ContextBuilder;

    const createFsm = () => new RefinementFSM(
      'task-1',
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      new TelemetryTracker()
    );
    const params = { issueSpec: 'repair', targetFiles: ['src/example.ts'], testFiles: [] };

    const baseline = await createFsm().runBaseline(params);
    const multiAgent = await createFsm().runLoop(params);

    expect(baseline.status).toBe('FAILED');
    expect(baseline.iterations[0]?.verification.testReport.oracleFailed).toBe(true);
    expect(multiAgent.status).toBe('FAILED');
    expect(multiAgent.iterations[0]?.verification.testReport.oracleFailed).toBe(true);
    expect(reviewer.review).not.toHaveBeenCalled();
    expect(git.rollback).toHaveBeenCalledTimes(2);
    expect(testHarness.executeSuite).not.toHaveBeenCalled();
  });

  it('measures a failed baseline once without invoking reviewer or refinement', async () => {
    const patch = '--- a/service.py\n+++ b/service.py\n@@ -1 +1 @@\n-return False\n+return True';
    const git = {
      computePatchHash: jest.fn(() => 'baseline-hash'),
      dryRunPatch: jest.fn(async () => true),
      applyPatch: jest.fn(async () => 'GIT' as const),
      rollback: jest.fn(async () => undefined)
    } as unknown as GitManager;
    const semgrep = {
      scan: jest.fn(async () => []),
      lastScanDurationMs: 12
    } as unknown as SemgrepEngine;
    const testReport: TestExecutionReport = {
      exitCode: 1,
      suitePassed: false,
      timedOut: false,
      oracleFailed: false,
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
      skippedTests: 0,
      xfailedTests: 0,
      errorTests: 0,
      passRate: 0,
      durationMs: 100,
      failureDetails: [{
        testName: 'FunctionalSuiteFailure',
        assertionMessage: 'AssertionError: expected false, got true',
        stackTrace: 'AssertionError'
      }],
      stdout: '1 failed in 0.1s',
      stderr: '',
      executionDurationMs: 100
    };
    const testHarness = {
      executeSuite: jest.fn(async () => testReport)
    } as unknown as TestHarness;
    const coder = {
      generatePatch: jest.fn(async () => patch)
    } as unknown as CoderAgent;
    const reviewer = {
      review: jest.fn()
    } as unknown as ReviewerAgent;
    const contextBuilder = {
      buildInitialPayload: jest.fn(async () => '{"source":"baseline"}')
    } as unknown as ContextBuilder;
    const fsm = new RefinementFSM(
      'baseline-passive-oracle',
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      new TelemetryTracker()
    );

    const result = await fsm.runBaseline({
      issueSpec: 'repair',
      targetFiles: ['service.py'],
      testFiles: ['test_service.py']
    });

    expect(result.status).toBe('FAILED');
    expect(result.currentIteration).toBe(1);
    expect(result.maxIterations).toBe(1);
    expect(result.iterations[0]?.verification.testReport.failedTests).toBe(1);
    expect(coder.generatePatch).toHaveBeenCalledTimes(1);
    expect(semgrep.scan).toHaveBeenCalledTimes(1);
    expect(testHarness.executeSuite).toHaveBeenCalledTimes(1);
    expect(reviewer.review).not.toHaveBeenCalled();
    expect(git.rollback).toHaveBeenCalledTimes(1);
  });

  it('terminates refinement as FAILED when the test runner reports an execution failure', async () => {
    const patch = '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new';
    const git = {
      computePatchHash: jest.fn(() => 'hash'),
      dryRunPatch: jest.fn(async () => true),
      applyPatch: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined)
    } as unknown as GitManager;
    const semgrep = {
      scan: jest.fn(async () => [])
    } as unknown as SemgrepEngine;
    const testHarness = {
      executeSuite: jest.fn(async () => ({
        suitePassed: false,
        oracleFailed: true,
        oracleFailureReason: 'Pytest unavailable',
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        failureDetails: [],
        stdout: '',
        stderr: '',
        executionDurationMs: 0
      }))
    } as unknown as TestHarness;
    const coder = {
      generatePatch: jest.fn(async () => patch)
    } as unknown as CoderAgent;
    const reviewer = {
      review: jest.fn()
    } as unknown as ReviewerAgent;
    const contextBuilder = {
      buildInitialPayload: jest.fn(async () => '{}')
    } as unknown as ContextBuilder;
    const fsm = new RefinementFSM(
      'task-2',
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      new TelemetryTracker()
    );

    const result = await fsm.runLoop({ issueSpec: 'repair', targetFiles: ['src/example.ts'], testFiles: [] });

    expect(result.status).toBe('FAILED');
    expect(result.iterations[0]?.verification.testReport.oracleFailed).toBe(true);
    expect(reviewer.review).not.toHaveBeenCalled();
    expect(git.rollback).toHaveBeenCalledTimes(1);
  });

  it('continues refinement after a functional test failure and converges on the next iteration', async () => {
    const patch = '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new';
    const git = {
      computePatchHash: jest.fn(() => 'hash'),
      dryRunPatch: jest.fn(async () => true),
      applyPatch: jest.fn(async () => undefined),
      rollback: jest.fn(async () => undefined)
    } as unknown as GitManager;
    const semgrep = {
      scan: jest.fn(async () => [])
    } as unknown as SemgrepEngine;
    const testHarness = {
      executeSuite: jest.fn<() => Promise<TestExecutionReport>>()
        .mockImplementationOnce(async () => ({
          exitCode: 1,
          suitePassed: false,
          timedOut: false,
          oracleFailed: false,
          totalTests: 1,
          passedTests: 0,
          failedTests: 1,
          skippedTests: 0,
          xfailedTests: 0,
          errorTests: 0,
          passRate: 0,
          durationMs: 10,
          failureDetails: [{
            testName: 'FunctionalSuiteFailure',
            assertionMessage: 'AssertionError: expected true, got false',
            stackTrace: 'AssertionError'
          }],
          stdout: '',
          stderr: '',
          executionDurationMs: 10
        }))
        .mockImplementationOnce(async () => ({
          exitCode: 0,
          suitePassed: true,
          timedOut: false,
          oracleFailed: false,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0,
          xfailedTests: 0,
          errorTests: 0,
          passRate: 1,
          durationMs: 10,
          failureDetails: [],
          stdout: '',
          stderr: '',
          executionDurationMs: 10
        }))
    } as unknown as TestHarness;
    const coder = {
      generatePatch: jest.fn(async () => patch)
    } as unknown as CoderAgent;
    const reviewer = {
      review: jest.fn(async () => ({
        rootCauseSummary: 'Fix failed assertion',
        violationsPrunedCount: 0,
        targetRemediations: [{
          file: 'src/example.ts',
          lineRange: { start: 1, end: 1 },
          rootCause: 'Incorrect result',
          mandatoryCorrection: 'Return the expected value.'
        }],
        securityPriorityStrict: true,
        flappingDetected: false
      }))
    } as unknown as ReviewerAgent;
    const contextBuilder = {
      buildInitialPayload: jest.fn(async () => '{}'),
      buildRefinementPayload: jest.fn(() => '{}')
    } as unknown as ContextBuilder;
    const fsm = new RefinementFSM(
      'task-3',
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      new TelemetryTracker()
    );

    const result = await fsm.runLoop({ issueSpec: 'repair', targetFiles: ['src/example.ts'], testFiles: [] });

    expect(result.status).toBe('CONVERGED');
    expect(result.iterations).toHaveLength(2);
    expect(reviewer.review).toHaveBeenCalledTimes(1);
    expect(coder.generatePatch).toHaveBeenCalledTimes(2);
    expect(testHarness.executeSuite).toHaveBeenCalledTimes(2);
    expect(git.rollback).toHaveBeenCalledTimes(2);
  });

  it('sends an execution timeout to the Reviewer and converges only after a later passing run', async () => {
    const patch = '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new';
    const git = {
      computePatchHash: jest.fn(() => 'hash'),
      dryRunPatch: jest.fn(async () => true),
      applyPatch: jest.fn(async () => 'GIT' as const),
      rollback: jest.fn(async () => undefined)
    } as unknown as GitManager;
    const semgrep = {
      scan: jest.fn(async () => []),
      lastScanDurationMs: 2
    } as unknown as SemgrepEngine;
    const timeoutReport: TestExecutionReport = {
      exitCode: null,
      suitePassed: false,
      timedOut: true,
      oracleFailed: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      xfailedTests: 0,
      errorTests: 0,
      passRate: 0,
      durationMs: 30000,
      failureDetails: [{
        testName: 'ExecutionTimeout',
        assertionMessage: 'Execution Timeout: execution exceeded 30s threshold',
        stackTrace: 'partial process output'
      }],
      stdout: 'partial process output',
      stderr: '',
      executionDurationMs: 30000
    };
    const passingReport: TestExecutionReport = {
      exitCode: 0,
      suitePassed: true,
      timedOut: false,
      oracleFailed: false,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      xfailedTests: 0,
      errorTests: 0,
      passRate: 1,
      durationMs: 10,
      failureDetails: [],
      stdout: '1 passed in 0.01s',
      stderr: '',
      executionDurationMs: 10
    };
    const testHarness = {
      executeSuite: jest.fn<() => Promise<TestExecutionReport>>()
        .mockResolvedValueOnce(timeoutReport)
        .mockResolvedValueOnce(passingReport)
    } as unknown as TestHarness;
    const coder = {
      generatePatch: jest.fn(async () => patch)
    } as unknown as CoderAgent;
    const reviewer = {
      review: jest.fn(async () => ({
        rootCauseSummary: 'Execution timeout',
        violationsPrunedCount: 0,
        targetRemediations: [{
          file: 'src/example.ts',
          lineRange: { start: 1, end: 1 },
          rootCause: 'The implementation did not terminate',
          mandatoryCorrection: 'Remove the non-terminating behavior.'
        }],
        securityPriorityStrict: true,
        flappingDetected: false
      }))
    } as unknown as ReviewerAgent;
    const contextBuilder = {
      buildInitialPayload: jest.fn(async () => '{}'),
      buildRefinementPayload: jest.fn(() => '{}')
    } as unknown as ContextBuilder;
    const fsm = new RefinementFSM(
      'timeout-is-refinement-feedback',
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      new TelemetryTracker()
    );

    const result = await fsm.runLoop({ issueSpec: 'repair loop', targetFiles: ['src/example.ts'], testFiles: [] });

    expect(result.status).toBe('CONVERGED');
    expect(result.iterations).toHaveLength(2);
    expect(result.iterations[0]?.verification.testReport.timedOut).toBe(true);
    expect(result.iterations[0]?.reviewerFeedback?.rootCauseSummary).toBe('Execution timeout');
    expect(reviewer.review).toHaveBeenCalledTimes(1);
    expect(coder.generatePatch).toHaveBeenCalledTimes(2);
  });

  it('does not converge on a skipped-test report and sends it through refinement', async () => {
    const patch = '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-old\n+new';
    const git = {
      computePatchHash: jest.fn(() => 'hash'),
      dryRunPatch: jest.fn(async () => true),
      applyPatch: jest.fn(async () => 'GIT' as const),
      rollback: jest.fn(async () => undefined)
    } as unknown as GitManager;
    const semgrep = {
      scan: jest.fn(async () => []),
      lastScanDurationMs: 2
    } as unknown as SemgrepEngine;
    const skippedReport: TestExecutionReport = {
      exitCode: 0,
      suitePassed: false,
      timedOut: false,
      oracleFailed: false,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      skippedTests: 1,
      xfailedTests: 0,
      errorTests: 0,
      passRate: 1,
      durationMs: 10,
      failureDetails: [{
        testName: 'TestSuiteNonConformity',
        assertionMessage: 'Suite non conforme: 2 passed, 0 failed, 1 skipped, 0 xfailed, 0 errors.',
        stackTrace: ''
      }],
      stdout: '2 passed, 1 skipped in 0.1s',
      stderr: '',
      executionDurationMs: 10
    };
    const testHarness = {
      executeSuite: jest.fn(async () => skippedReport)
    } as unknown as TestHarness;
    const coder = {
      generatePatch: jest.fn(async () => patch)
    } as unknown as CoderAgent;
    const reviewer = {
      review: jest.fn(async () => ({
        rootCauseSummary: 'A skipped test does not verify its contract',
        violationsPrunedCount: 0,
        targetRemediations: [{
          file: 'src/example.ts',
          lineRange: { start: 1, end: 1 },
          rootCause: 'The suite contains a skipped contract',
          mandatoryCorrection: 'Make the task test execute and pass.'
        }],
        securityPriorityStrict: true,
        flappingDetected: false
      }))
    } as unknown as ReviewerAgent;
    const contextBuilder = {
      buildInitialPayload: jest.fn(async () => '{}'),
      buildRefinementPayload: jest.fn(() => '{}')
    } as unknown as ContextBuilder;
    const fsm = new RefinementFSM(
      'skipped-tests-never-converge',
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      new TelemetryTracker()
    );

    const result = await fsm.runLoop({ issueSpec: 'repair', targetFiles: ['src/example.ts'], testFiles: [] });

    expect(result.status).toBe('UNRESOLVED');
    expect(result.iterations).toHaveLength(3);
    expect(result.iterations.every((iteration) => !iteration.verification.verified)).toBe(true);
    expect(reviewer.review).toHaveBeenCalledTimes(2);
    expect(coder.generatePatch).toHaveBeenCalledTimes(3);
  });
});
