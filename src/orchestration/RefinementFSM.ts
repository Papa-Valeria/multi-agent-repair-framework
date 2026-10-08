import { GitManager } from '../git/GitManager.js';
import { SemgrepEngine } from '../verification/SemgrepEngine.js';
import { TestHarness } from '../verification/TestHarness.js';
import { ReviewerAgent } from '../agents/ReviewerAgent.js';
import { ContextBuilder, InitialContextParams } from './ContextBuilder.js';
import { TelemetryTracker } from '../telemetry/TelemetryTracker.js';
import {
  WorkbenchSessionState,
  IterationRecord,
  VerificationVerdict,
  TestExecutionReport,
  WorkbenchStreamEvent,
  ReviewerFeedbackPayload
} from '../types/domain.js';
import { CoderAgent } from '../agents/CoderAgent.js';

export type SSEPublisher = (event: WorkbenchStreamEvent) => void;

export class RefinementFSM {
  private static readonly MAX_ITERATIONS = 3;

  constructor(
    private readonly taskId: string,
    private readonly gitManager: GitManager,
    private readonly semgrep: SemgrepEngine,
    private readonly testHarness: TestHarness,
    private readonly coder: CoderAgent,
    private readonly reviewer: ReviewerAgent,
    private readonly contextBuilder: ContextBuilder,
    private readonly telemetryTracker: TelemetryTracker,
    private readonly ssePublisher?: SSEPublisher
  ) { }


  public async runBaseline(params: InitialContextParams): Promise<WorkbenchSessionState> {
    this.telemetryTracker.startIteration();
    const tStartPayload = this.telemetryTracker.startCpuMeasurement();
    const initialPayload = await this.contextBuilder.buildInitialPayload(params);
    this.telemetryTracker.recordOrchestrationCpu(tStartPayload);

    this.publishPhase(1, 'INSPECTION');

    let patchDiff = '';
    let generationError: string | undefined;
    const tCoderCpu = this.telemetryTracker.startCpuMeasurement();
    try {
      patchDiff = await this.coder.generatePatch(initialPayload, params.targetFiles);
    } catch (err: unknown) {
      generationError = (err as Error)?.message;
      console.warn('[Baseline] Errore estrazione patch:', generationError);
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tCoderCpu);
    }

    const tStartGit = this.telemetryTracker.startCpuMeasurement();
    const hash = patchDiff ? this.gitManager.computePatchHash(patchDiff) : '';
    const isApplicable = patchDiff ? await this.gitManager.dryRunPatch(patchDiff) : false;
    this.telemetryTracker.recordOrchestrationCpu(tStartGit);

    let verdict: VerificationVerdict = patchDiff
      ? this.createEmptyVerdict()
      : this.createEmptyVerdict('DiffFormatFailure', `Diff Extraction Failure: ${generationError ?? 'nessuna patch prodotta dal modello.'}`);
    let applyMode: IterationRecord['applyMode'] = 'NOT_APPLICABLE';

    if (isApplicable && patchDiff) {
      const tApply = this.telemetryTracker.startCpuMeasurement();
      applyMode = await this.gitManager.applyPatch(patchDiff);
      this.telemetryTracker.recordOrchestrationCpu(tApply);

      this.publishPhase(1, 'EVALUATION');
      let currentOracle: 'SEMGREP' | 'TEST_HARNESS' = 'SEMGREP';
      let sastFindings: VerificationVerdict['sastFindings'] = [];
      let semgrepDurationMs = 0;
      try {
        const tSemgrepCpu = this.telemetryTracker.startCpuMeasurement();
        try {
          sastFindings = await this.semgrep.scan(params.targetFiles, patchDiff, params.category ?? 'REPAIR');
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tSemgrepCpu);
        }
        semgrepDurationMs = this.semgrep.lastScanDurationMs;
        this.telemetryTracker.recordOracleDuration(semgrepDurationMs);
        this.publishOracleProgress('SEMGREP', true, sastFindings.length);

        currentOracle = 'TEST_HARNESS';
        const tTestCpu = this.telemetryTracker.startCpuMeasurement();
        let tests: TestExecutionReport;
        try {
          tests = await this.testHarness.executeSuite();
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tTestCpu);
        }
        this.telemetryTracker.recordOracleDuration(tests.executionDurationMs);
        this.publishOracleProgress('TEST_HARNESS', !tests.oracleFailed, tests.failedTests);

        verdict = {
          verified: !tests.oracleFailed && sastFindings.length === 0 && tests.suitePassed,
          sastFindings,
          semgrepDurationMs,
          testReport: tests
        };
      } catch (err: unknown) {
        semgrepDurationMs = this.semgrep.lastScanDurationMs;
        if (currentOracle === 'SEMGREP') this.telemetryTracker.recordOracleDuration(semgrepDurationMs);
        this.publishOracleProgress(currentOracle, false, 0);
        verdict = this.createOracleFailureVerdict(currentOracle, err, sastFindings, semgrepDurationMs);
      } finally {
        const tRollback = this.telemetryTracker.startCpuMeasurement();
        await this.gitManager.rollback();
        this.telemetryTracker.recordOrchestrationCpu(tRollback);
      }
    }

    const snapshot = this.telemetryTracker.getSnapshot();
    const iterRecord: IterationRecord = {
      iteration: 1,
      patchDiff,
      patchHash: hash,
      isApplicable,
      verification: verdict,
      telemetry: snapshot,
      agentUsage: this.telemetryTracker.getIterationAgentUsage(),
      patchChanges: this.getPatchChanges(patchDiff),
      applyMode,
      fuzzyFallbackUsed: applyMode === 'FUZZY'
    };

    const finalState: WorkbenchSessionState = {
      taskId: this.taskId,
      issueSpec: params.issueSpec,
      status: verdict.verified ? 'CONVERGED' : 'FAILED',
      targetFiles: params.targetFiles,
      currentIteration: 1,
      maxIterations: 1,
      iterations: [iterRecord],
      finalPatch: patchDiff || undefined,
      cumulativeTelemetry: snapshot
    };

    this.ssePublisher?.({ type: 'ITERATION_COMPLETE', payload: finalState });
    return finalState;
  }

  public async runLoop(params: InitialContextParams): Promise<WorkbenchSessionState> {
    const iterations: IterationRecord[] = [];

    const tInitPayload = this.telemetryTracker.startCpuMeasurement();
    let currentPayload = await this.contextBuilder.buildInitialPayload(params);
    this.telemetryTracker.recordOrchestrationCpu(tInitPayload);

    let finalStatus: 'CONVERGED' | 'UNRESOLVED' | 'FAILED' = 'FAILED';
    const seenPatchHashes = new Set<string>();

    for (let n = 1; n <= RefinementFSM.MAX_ITERATIONS; n++) {
      this.telemetryTracker.startIteration();
      this.publishPhase(n, 'INSPECTION');

      let patchDiff = '';
      const tCoderCpu = this.telemetryTracker.startCpuMeasurement();
      try {
        patchDiff = await this.coder.generatePatch(currentPayload, params.targetFiles);
      } catch (err: unknown) {
        console.warn(`[Iteration ${n}] Diff extraction error:`, (err as Error)?.message);

        const failureVerdict = this.createEmptyVerdict(
          'DiffFormatFailure',
          'Diff Extraction Failure: The model did not output a valid Unified Diff containing valid hunks.'
        );

        if (n < RefinementFSM.MAX_ITERATIONS) {
          this.publishPhase(n, 'REFINEMENT');
          const feedback: ReviewerFeedbackPayload = {
            rootCauseSummary:
              'Diff Extraction Failure: Output must be a valid unified diff block (```diff ... ```) modifying only target source files.',
            violationsPrunedCount: 0,
            targetRemediations: [
              {
                file: params.targetFiles[0] ?? 'unknown',
                lineRange: { start: 1, end: 1 },
                rootCause: 'Malformed diff or missing headers.',
                mandatoryCorrection:
                  'Regenerate the diff with standard headers (--- a/file +++ b/file) and exact context lines.'
              }
            ],
            securityPriorityStrict: true,
            flappingDetected: false
          };

          iterations.push({
            iteration: n,
            patchDiff: '',
            patchHash: '',
            isApplicable: false,
            verification: failureVerdict,
            reviewerFeedback: feedback,
            telemetry: this.telemetryTracker.getSnapshot(),
            agentUsage: this.telemetryTracker.getIterationAgentUsage(),
            patchChanges: this.getPatchChanges(''),
            applyMode: 'NOT_APPLICABLE',
            fuzzyFallbackUsed: false
          });

          const tRefineCtx = this.telemetryTracker.startCpuMeasurement();
          currentPayload = this.contextBuilder.buildRefinementPayload(currentPayload, '', feedback);
          this.telemetryTracker.recordOrchestrationCpu(tRefineCtx);
          continue;
        } else {
          iterations.push({
            iteration: n,
            patchDiff: '',
            patchHash: '',
            isApplicable: false,
            verification: failureVerdict,
            telemetry: this.telemetryTracker.getSnapshot(),
            agentUsage: this.telemetryTracker.getIterationAgentUsage(),
            patchChanges: this.getPatchChanges(''),
            applyMode: 'NOT_APPLICABLE',
            fuzzyFallbackUsed: false
          });
          finalStatus = 'FAILED';
          break;
        }
      } finally {
        this.telemetryTracker.recordOrchestrationCpu(tCoderCpu);
      }

      const tGitDryRun = this.telemetryTracker.startCpuMeasurement();
      const patchHash = this.gitManager.computePatchHash(patchDiff);
      const flappingDetected = seenPatchHashes.has(patchHash);
      seenPatchHashes.add(patchHash);
      const isApplicable = await this.gitManager.dryRunPatch(patchDiff);
      this.telemetryTracker.recordOrchestrationCpu(tGitDryRun);

      if (!isApplicable) {
        console.warn(`[Iteration ${n}] Patch application failed. Triggering refinement.`);
        const failureVerdict = this.createEmptyVerdict(
          'DryRunFailure',
          'Patch Application Failure: git apply --check failed. Context lines do not match target file.'
        );

        if (n < RefinementFSM.MAX_ITERATIONS) {
          this.publishPhase(n, 'REFINEMENT');
          const feedback: ReviewerFeedbackPayload = {
            rootCauseSummary:
              'Git Apply Failure: The generated diff could not be applied cleanly. Check exact line contents and do not escape quotation marks.',
            violationsPrunedCount: 0,
            targetRemediations: [
              {
                file: params.targetFiles[0] ?? 'unknown',
                lineRange: { start: 1, end: 1 },
                rootCause: 'Malformed diff or incorrect context line.',
                mandatoryCorrection:
                  'Regenerate the diff matching the source file lines exactly, without modifying test files.'
              }
            ],
            securityPriorityStrict: true,
            flappingDetected
          };

          iterations.push({
            iteration: n,
            patchDiff,
            patchHash,
            isApplicable: false,
            verification: failureVerdict,
            reviewerFeedback: feedback,
            telemetry: this.telemetryTracker.getSnapshot(),
            agentUsage: this.telemetryTracker.getIterationAgentUsage(),
            patchChanges: this.getPatchChanges(patchDiff),
            applyMode: 'NOT_APPLICABLE',
            fuzzyFallbackUsed: false
          });

          const tRollback = this.telemetryTracker.startCpuMeasurement();
          await this.gitManager.rollback();
          currentPayload = this.contextBuilder.buildRefinementPayload(currentPayload, patchDiff, feedback);
          this.telemetryTracker.recordOrchestrationCpu(tRollback);
          continue;
        } else {
          iterations.push({
            iteration: n,
            patchDiff,
            patchHash,
            isApplicable: false,
            verification: failureVerdict,
            telemetry: this.telemetryTracker.getSnapshot(),
            agentUsage: this.telemetryTracker.getIterationAgentUsage(),
            patchChanges: this.getPatchChanges(patchDiff),
            applyMode: 'NOT_APPLICABLE',
            fuzzyFallbackUsed: false
          });
          finalStatus = 'FAILED';
          const tRollback = this.telemetryTracker.startCpuMeasurement();
          await this.gitManager.rollback();
          this.telemetryTracker.recordOrchestrationCpu(tRollback);
          break;
        }
      }

      const tApply = this.telemetryTracker.startCpuMeasurement();
      const applyMode = await this.gitManager.applyPatch(patchDiff);
      this.telemetryTracker.recordOrchestrationCpu(tApply);

      this.publishPhase(n, 'EVALUATION');

      let currentOracle: 'SEMGREP' | 'TEST_HARNESS' = 'SEMGREP';
      let sastFindings: VerificationVerdict['sastFindings'] = [];
      let testReport: TestExecutionReport;
      let semgrepDurationMs = 0;
      try {
        const tSemgrepCpu = this.telemetryTracker.startCpuMeasurement();
        try {
          sastFindings = await this.semgrep.scan(params.targetFiles, patchDiff, params.category ?? 'REPAIR');
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tSemgrepCpu);
        }
        semgrepDurationMs = this.semgrep.lastScanDurationMs;
        this.telemetryTracker.recordOracleDuration(semgrepDurationMs);
        this.publishOracleProgress('SEMGREP', true, sastFindings.length);

        currentOracle = 'TEST_HARNESS';
        const tTestCpu = this.telemetryTracker.startCpuMeasurement();
        try {
          testReport = await this.testHarness.executeSuite();
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tTestCpu);
        }
        this.telemetryTracker.recordOracleDuration(testReport.executionDurationMs);
        this.publishOracleProgress('TEST_HARNESS', !testReport.oracleFailed, testReport.failedTests);
      } catch (err: unknown) {
        semgrepDurationMs = this.semgrep.lastScanDurationMs;
        if (currentOracle === 'SEMGREP') this.telemetryTracker.recordOracleDuration(semgrepDurationMs);
        this.publishOracleProgress(currentOracle, false, 0);
        const failureVerdict = this.createOracleFailureVerdict(currentOracle, err, sastFindings, semgrepDurationMs);
        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: failureVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY'
        });
        finalStatus = 'FAILED';

        const tRollback = this.telemetryTracker.startCpuMeasurement();
        await this.gitManager.rollback();
        this.telemetryTracker.recordOrchestrationCpu(tRollback);
        break;
      }

      const isVerified = !testReport.oracleFailed && sastFindings.length === 0 && testReport.suitePassed;
      const verdict: VerificationVerdict = {
        verified: isVerified,
        sastFindings,
        semgrepDurationMs,
        testReport
      };

      if (testReport.oracleFailed) {
        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY'
        });
        finalStatus = 'FAILED';

        const tRollback = this.telemetryTracker.startCpuMeasurement();
        await this.gitManager.rollback();
        this.telemetryTracker.recordOrchestrationCpu(tRollback);
        break;
      }

      const currentSnapshot = this.telemetryTracker.getSnapshot();
      this.ssePublisher?.({
        type: 'TELEMETRY_UPDATE',
        payload: {
          promptTokens: currentSnapshot.promptTokens,
          completionTokens: currentSnapshot.completionTokens,
          durationMs: currentSnapshot.totalDurationMs
        }
      });

      if (isVerified) {
        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY'
        });
        finalStatus = 'CONVERGED';
        const tRollback = this.telemetryTracker.startCpuMeasurement();
        await this.gitManager.rollback();
        this.telemetryTracker.recordOrchestrationCpu(tRollback);
        break;
      }

      if (n < RefinementFSM.MAX_ITERATIONS) {
        this.publishPhase(n, 'REFINEMENT');

        const tReviewerCpu = this.telemetryTracker.startCpuMeasurement();
        let feedback: ReviewerFeedbackPayload;
        try {
          feedback = await this.reviewer.review(sastFindings, testReport, flappingDetected, params.targetFiles);
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tReviewerCpu);
        }

        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          reviewerFeedback: feedback,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY'
        });

        const tRefineSetup = this.telemetryTracker.startCpuMeasurement();
        await this.gitManager.rollback();
        currentPayload = this.contextBuilder.buildRefinementPayload(currentPayload, patchDiff, feedback);
        this.telemetryTracker.recordOrchestrationCpu(tRefineSetup);
      } else {
        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY'
        });
        finalStatus = 'UNRESOLVED';

        const tRollback = this.telemetryTracker.startCpuMeasurement();
        await this.gitManager.rollback();
        this.telemetryTracker.recordOrchestrationCpu(tRollback);
      }
    }

    const state: WorkbenchSessionState = {
      taskId: this.taskId,
      issueSpec: params.issueSpec,
      status: finalStatus,
      targetFiles: params.targetFiles,
      currentIteration: iterations.length,
      maxIterations: RefinementFSM.MAX_ITERATIONS,
      iterations,
      finalPatch: iterations[iterations.length - 1]?.patchDiff || undefined,
      cumulativeTelemetry: this.telemetryTracker.getSnapshot()
    };

    this.ssePublisher?.({ type: 'ITERATION_COMPLETE', payload: state });
    return state;
  }

  private publishPhase(iteration: number, state: 'INSPECTION' | 'EVALUATION' | 'REFINEMENT'): void {
    this.ssePublisher?.({
      type: 'PHASE_TRANSITION',
      payload: { iteration, state }
    });
  }

  private publishOracleProgress(tool: 'SEMGREP' | 'TEST_HARNESS', completed: boolean, findingsCount: number): void {
    this.ssePublisher?.({
      type: 'ORACLE_PROGRESS',
      payload: { tool, completed, findingsCount }
    });
  }

  private createEmptyVerdict(
    testName = 'DryRunFailure',
    message = 'Patch Application Failure: git apply failed.'
  ): VerificationVerdict {
    return {
      verified: false,
      sastFindings: [],
      testReport: {
        exitCode: null,
        suitePassed: false,
        timedOut: false,
        oracleFailed: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        xfailedTests: 0,
        errorTests: 0,
        passRate: 0,
        durationMs: 0,
        failureDetails: [
          {
            testName,
            assertionMessage: message,
            stackTrace: 'Il delta contiene indici o contesti disallineati.'
          }
        ],
        stdout: '',
        stderr: '',
        executionDurationMs: 0
      }
    };
  }

  private createOracleFailureVerdict(
    oracle: 'SEMGREP' | 'TEST_HARNESS',
    error: unknown,
    sastFindings: VerificationVerdict['sastFindings'] = [],
    semgrepDurationMs = 0
  ): VerificationVerdict {
    const detail = error instanceof Error ? error.message : String(error);
    const reason = `${oracle} oracle failure: ${detail}`;
    return {
      verified: false,
      sastFindings,
      semgrepDurationMs,
      testReport: {
        exitCode: null,
        suitePassed: false,
        timedOut: false,
        oracleFailed: true,
        oracleFailureReason: reason,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        xfailedTests: 0,
        errorTests: 0,
        passRate: 0,
        durationMs: 0,
        failureDetails: [
          {
            testName: 'OracleExecutionFailure',
            assertionMessage: reason,
            stackTrace: error instanceof Error ? error.stack ?? error.message : detail
          }
        ],
        stdout: '',
        stderr: '',
        executionDurationMs: 0
      }
    };
  }

  private getPatchChanges(patchDiff: string): { addedLines: number; deletedLines: number } {
    let addedLines = 0;
    let deletedLines = 0;
    for (const line of patchDiff.split(/\r?\n/)) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) addedLines += 1;
      if (line.startsWith('-')) deletedLines += 1;
    }
    return { addedLines, deletedLines };
  }
}
