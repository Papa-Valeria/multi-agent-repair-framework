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
  WorkbenchStreamEvent,
  ReviewerFeedbackPayload
} from '../types/domain.js';
import { CoderAgent } from '../agents/CoderAgent.js';

export type SSEPublisher = (event: WorkbenchStreamEvent) => void;

export class RefinementFSM {
  private static readonly MAX_ITERATIONS = 3; // N_max = 3

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
  ) {}

  /**
   * Esegue la Baseline Single-Agent (RF-09): singolo passaggio del Coder senza loop.
   */
  public async runBaseline(params: InitialContextParams): Promise<WorkbenchSessionState> {
    const initialPayload = await this.contextBuilder.buildInitialPayload(params);
    let patchDiff = '';
    try {
      patchDiff = await this.coder.generatePatch(initialPayload);
    } catch (err: any) {
      console.warn('[Baseline] Errore estrazione patch:', err?.message);
    }

    const hash = patchDiff ? this.gitManager.computePatchHash(patchDiff) : '';
    const isApplicable = patchDiff ? await this.gitManager.dryRunPatch(patchDiff) : false;

    let verdict: VerificationVerdict = this.createEmptyVerdict();

    if (isApplicable && patchDiff) {
      await this.gitManager.applyPatch(patchDiff);
      const sast = await this.semgrep.scan(params.targetFiles, patchDiff);
      const tests = await this.testHarness.executeSuite();
      verdict = {
        verified: sast.length === 0 && tests.suitePassed,
        sastFindings: sast,
        testReport: tests
      };
      await this.gitManager.rollback();
    }

    const snapshot = this.telemetryTracker.getSnapshot();
    const iterRecord: IterationRecord = {
      iteration: 1,
      patchDiff,
      patchHash: hash,
      isApplicable,
      verification: verdict,
      telemetry: snapshot
    };

    return {
      taskId: this.taskId,
      issueSpec: params.issueSpec,
      status: verdict.verified ? 'CONVERGED' : 'FAILED',
      targetFiles: params.targetFiles,
      currentIteration: 1,
      maxIterations: 1,
      iterations: [iterRecord],
      finalPatch: patchDiff,
      cumulativeTelemetry: snapshot
    };
  }

  /**
   * Esegue il ciclo completo Multi-Agent con self-refinement FSM (RF-07).
   */
  public async runLoop(params: InitialContextParams): Promise<WorkbenchSessionState> {
    const iterations: IterationRecord[] = [];
    let currentPayload = await this.contextBuilder.buildInitialPayload(params);
    let finalStatus: 'CONVERGED' | 'UNRESOLVED' | 'FAILED' | 'RUNNING' = 'RUNNING';
    const seenPatchHashes = new Set<string>();

    for (let n = 1; n <= RefinementFSM.MAX_ITERATIONS; n++) {
      this.publishPhase(n, 'INSPECTION');

      let patchDiff = '';
      try {
        patchDiff = await this.coder.generatePatch(currentPayload);
      } catch (err: any) {
        console.warn(`[Iteration ${n}] Diff extraction error:`, err?.message);

        const failureVerdict = this.createEmptyVerdict(
          'DiffFormatFailure',
          'Diff Extraction Failure: The model did not output a valid Unified Diff containing valid hunks.'
        );

        if (n < RefinementFSM.MAX_ITERATIONS) {
          this.publishPhase(n, 'REFINEMENT');
          const feedback: ReviewerFeedbackPayload = {
            rootCauseSummary: "Diff Extraction Failure: Output must be a valid unified diff block (```diff ... ```) modifying only target source files.",
            violationsPrunedCount: 0,
            targetRemediations: [{
              file: params.targetFiles[0] ?? "unknown",
              lineRange: { start: 1, end: 1 },
              rootCause: "Malformed diff or missing headers.",
              mandatoryCorrection: "Regenerate the diff with standard headers (--- a/file +++ b/file) and exact context lines."
            }],
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
            telemetry: this.telemetryTracker.getSnapshot()
          });

          currentPayload = this.contextBuilder.buildRefinementPayload(currentPayload, '', feedback);
          continue;
        } else {
          iterations.push({
            iteration: n,
            patchDiff: '',
            patchHash: '',
            isApplicable: false,
            verification: failureVerdict,
            telemetry: this.telemetryTracker.getSnapshot()
          });
          finalStatus = 'FAILED';
          break;
        }
      }

      const patchHash = this.gitManager.computePatchHash(patchDiff);
      const flappingDetected = seenPatchHashes.has(patchHash);
      seenPatchHashes.add(patchHash);

      const isApplicable = await this.gitManager.dryRunPatch(patchDiff);
      if (!isApplicable) {
        console.warn(`[Iteration ${n}] Patch application failed. Triggering refinement.`);
        const failureVerdict = this.createEmptyVerdict(
          'DryRunFailure',
          'Patch Application Failure: git apply --check failed. Context lines do not match target file.'
        );

        if (n < RefinementFSM.MAX_ITERATIONS) {
          this.publishPhase(n, 'REFINEMENT');
          const feedback: ReviewerFeedbackPayload = {
            rootCauseSummary: "Git Apply Failure: The generated diff could not be applied cleanly. Check exact line contents and do not escape quotation marks.",
            violationsPrunedCount: 0,
            targetRemediations: [{
              file: params.targetFiles[0] ?? "unknown",
              lineRange: { start: 1, end: 1 },
              rootCause: "Malformed diff or incorrect context line.",
              mandatoryCorrection: "Regenerate the diff matching the source file lines exactly, without modifying test files."
            }],
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
            telemetry: this.telemetryTracker.getSnapshot()
          });

          await this.gitManager.rollback();
          currentPayload = this.contextBuilder.buildRefinementPayload(currentPayload, patchDiff, feedback);
          continue;
        } else {
          iterations.push({
            iteration: n,
            patchDiff,
            patchHash,
            isApplicable: false,
            verification: failureVerdict,
            telemetry: this.telemetryTracker.getSnapshot()
          });
          finalStatus = 'FAILED';
          await this.gitManager.rollback();
          break;
        }
      }

      await this.gitManager.applyPatch(patchDiff);

      this.publishPhase(n, 'EVALUATION');
      const sastFindings = await this.semgrep.scan(params.targetFiles, patchDiff);
      this.ssePublisher?.({
        type: 'ORACLE_PROGRESS',
        payload: { tool: 'SEMGREP', completed: true, findingsCount: sastFindings.length }
      });

      const testReport = await this.testHarness.executeSuite();
      this.ssePublisher?.({
        type: 'ORACLE_PROGRESS',
        payload: { tool: 'TEST_HARNESS', completed: true, findingsCount: testReport.failedTests }
      });

      const isVerified = sastFindings.length === 0 && testReport.suitePassed;
      const verdict: VerificationVerdict = {
        verified: isVerified,
        sastFindings,
        testReport
      };

      if (isVerified) {
        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot()
        });
        finalStatus = 'CONVERGED';
        break;
      }

      if (n < RefinementFSM.MAX_ITERATIONS) {
        this.publishPhase(n, 'REFINEMENT');
        const feedback = await this.reviewer.review(sastFindings, testReport, flappingDetected);

        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          reviewerFeedback: feedback,
          telemetry: this.telemetryTracker.getSnapshot()
        });

        await this.gitManager.rollback();
        currentPayload = this.contextBuilder.buildRefinementPayload(currentPayload, patchDiff, feedback);
      } else {
        iterations.push({
          iteration: n,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot()
        });
        finalStatus = 'UNRESOLVED';
        await this.gitManager.rollback();
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
      finalPatch: iterations[iterations.length - 1]?.patchDiff,
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

  private createEmptyVerdict(testName = 'DryRunFailure', message = 'Patch Application Failure: git apply failed.'): VerificationVerdict {
    return {
      verified: false,
      sastFindings: [],
      testReport: {
        suitePassed: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        failureDetails: [{
          testName,
          assertionMessage: message,
          stackTrace: 'Il delta contiene indici o contesti disallineati.'
        }],
        rawStderr: '',
        executionDurationMs: 0
      }
    };
  }
}
