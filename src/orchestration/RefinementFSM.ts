import {
  CoderAgent,
  CoderModelInvocationError,
  CoderOutputExtractionError
} from '../agents/CoderAgent.js';
import { ReviewerAgent } from '../agents/ReviewerAgent.js';
import { GitManager, type PatchScope } from '../git/GitManager.js';
import { TelemetryTracker } from '../telemetry/TelemetryTracker.js';
import type {
  CumulativeRemediation,
  ExecutionErrorCategory,
  ExecutionFailure,
  ExecutionPhase,
  IterationRecord,
  OracleName,
  OracleResult,
  ReviewerFeedbackPayload,
  RollbackResult,
  TargetRemediation,
  VerificationVerdict,
  WorkbenchSessionState,
  WorkbenchStreamEvent
} from '../types/domain.js';
import { BuildSyntaxOracle } from '../verification/BuildSyntaxOracle.js';
import {
  decideOracleResults,
  DEFAULT_ORACLE_PROFILE,
  type OracleDecision
} from '../verification/OracleDecision.js';
import { SemgrepEngine } from '../verification/SemgrepEngine.js';
import { TestHarness } from '../verification/TestHarness.js';
import {
  assertBuildSyntaxResultInvariants,
  assertFunctionalTestResultInvariants,
  assertSemgrepResultInvariants,
  assertVerificationVerdictInvariants,
  assertWorkbenchSessionInvariants,
  VerificationInvariantError,
  assertApplicabilityResultInvariants
} from '../verification/VerificationInvariants.js';
import { ContextBuilder, type InitialContextParams } from './ContextBuilder.js';
import {
  describeTerminalState,
  resolveTerminalState,
  type TerminalStateResolution
} from './TerminalStatePolicy.js';
import type { ExperimentLimits } from '../types/analytics.js';

export type SSEPublisher = (event: WorkbenchStreamEvent) => void;

interface AppliedPatchEvaluation {
  readonly oracleResults: readonly OracleResult[];
  readonly buildSyntax: OracleResult<'BUILD_SYNTAX'>;
  readonly semgrep: OracleResult<'SEMGREP'>;
  readonly functionalTest: OracleResult<'FUNCTIONAL_TEST'>;
}

interface ApplicablePatchGeneration {
  readonly patchDiff: string;
  readonly patchHash: string;
  readonly applicability: OracleResult<'APPLICABILITY'>;
  readonly technicalAttempts: number;
}

class CoderPatchGenerationError extends Error {
  constructor(
    message: string,
    readonly category: | 'DIFF_EXTRACTION_FAILURE' | 'MODEL_GENERATION_FAILURE'
  ) {
    super(message);
    this.name = 'CoderPatchGenerationError';
  }
}

export class RefinementFSM {
  private initialHead: string | undefined;
  private rollbackResult: RollbackResult | undefined;


  constructor(
    private readonly taskId: string,
    private readonly gitManager: GitManager,
    private readonly semgrep: SemgrepEngine,
    private readonly testHarness: TestHarness,
    private readonly buildSyntaxOracle: BuildSyntaxOracle,
    private readonly coder: CoderAgent,
    private readonly reviewer: ReviewerAgent,
    private readonly contextBuilder: ContextBuilder,
    private readonly telemetryTracker: TelemetryTracker,
    private readonly limits: ExperimentLimits,
    private readonly ssePublisher?: SSEPublisher
  ) { }

  public async runBaseline(params: InitialContextParams): Promise<WorkbenchSessionState> {
    const transactionFailure = await this.initializeTransaction(1);

    if (transactionFailure) {
      return this.publishFinalState(this.createFailureState(params, transactionFailure, [], this.limits.maxIterations));
    }

    const patchScope: PatchScope = {
      category: params.category,
      targetFiles: params.targetFiles,
      testFiles: params.testFiles
    };

    this.telemetryTracker.startIteration();

    let initialPayload: string = '';
    let initialPayloadFailure: ExecutionFailure | undefined;

    const tStartPayload = this.telemetryTracker.startCpuMeasurement();

    try {
      initialPayload = await this.contextBuilder.buildInitialPayload(params);
    } catch (error: unknown) {
      initialPayloadFailure = this.toFailure('INITIALIZATION', 'CONTEXT_BUILD_FAILURE', error, false, 1);
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tStartPayload);
    }

    if (initialPayloadFailure) {
      return this.publishFinalState(this.createFailureState(params, initialPayloadFailure, [], this.limits.maxIterations));
    }

    this.publishPhase(1, 'INSPECTION');
    let patchDiff = '';
    let coderFailure: ExecutionFailure | undefined;
    const tCoderCpu = this.telemetryTracker.startCpuMeasurement();

    try {
      patchDiff = await this.coder.generatePatch(initialPayload, params.targetFiles, params.testFiles, params.category);
      console.log(`[Baseline] GENERATED PATCH:\n${patchDiff}`);
    } catch (error: unknown) {
      const coderCategory = this.classifyTypedCoderFailure(error);
      coderFailure = this.toFailure('INSPECTION', coderCategory ?? 'UNKNOWN_FAILURE', error, false, 1);
      console.warn('[Baseline] Coder failure:', coderFailure.message);
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tCoderCpu);
    }

    if (coderFailure) {
      const failureDescriptor = coderFailure.category === 'DIFF_EXTRACTION_FAILURE' ? {
        testName: 'DiffFormatFailure',
        message: `Diff Extraction Failure: ${coderFailure.message}`
      } : coderFailure.category === 'MODEL_GENERATION_FAILURE' ? {
        testName: 'ModelGenerationFailure',
        message: `Model Generation Failure: ${coderFailure.message}`
      } : {
        testName: 'UnknownFailure',
        message: `Unknown Coder Failure: ${coderFailure.message}`
      };

      const verdict = this.createEmptyVerdict(failureDescriptor.testName, failureDescriptor.message);


      const snapshot = this.telemetryTracker.getSnapshot();

      const iterationRecord:
        IterationRecord = {
        iteration: 1,
        patchDiff: '',
        patchHash: '',
        isApplicable: false,
        verification: verdict,
        telemetry: snapshot,
        agentUsage: this.telemetryTracker.getIterationAgentUsage(),
        patchChanges: this.getPatchChanges(''),
        applyMode: 'NOT_APPLICABLE',
        fuzzyFallbackUsed: false,
        failure: coderFailure
      };

      const terminalResolution =
        this.resolveTerminalResolution({
          failure: coderFailure,
          refinementBudgetExhausted: true
        });

      return this.publishFinalState({
        taskId: this.taskId,
        issueSpec: params.issueSpec,
        category: params.category,
        status: terminalResolution.status,
        autonomousStatus: terminalResolution.status,
        finalizationStatus: 'NOT_FINALIZED',
        candidateVerified: false,
        autonomousRunSucceeded: false,
        targetFiles: params.targetFiles,
        testFiles: params.testFiles,
        currentIteration: 1,
        maxIterations: this.limits.maxIterations,
        iterations: [iterationRecord],
        cumulativeTelemetry: snapshot,
        failure: coderFailure,
        ...(this.initialHead
          ? {
            initialHead:
              this.initialHead
          }
          : {}),
        terminationReason:
          describeTerminalState(
            terminalResolution,
            coderFailure
          )
      });
    }

    let patchHash = '';
    let applicability: OracleResult<'APPLICABILITY'> | undefined;
    let baselineBoundaryFailure: ExecutionFailure | undefined;

    try {
      patchHash = this.gitManager.computePatchHash(patchDiff);
    } catch (error: unknown) {
      baselineBoundaryFailure = this.toFailure('PATCH_VALIDATION', 'INFRASTRUCTURE_FAILURE', error, false, 1);
    }

    if (!baselineBoundaryFailure) {
      const tApplicability = this.telemetryTracker.startCpuMeasurement();
      try {
        applicability = await this.gitManager.evaluateApplicability(patchDiff, patchScope, true);
      } catch (error: unknown) {
        baselineBoundaryFailure = this.toFailure('PATCH_VALIDATION', 'ORACLE_EXECUTION_FAILURE', error, false, 1, 'APPLICABILITY');
      } finally {
        this.telemetryTracker.recordOrchestrationCpu(tApplicability);
      }
    }

    if (baselineBoundaryFailure || applicability === undefined) {
      const failure = baselineBoundaryFailure ?? this.toFailure(
        'PATCH_VALIDATION',
        'ORACLE_EXECUTION_FAILURE',
        'Invariante interna violata: il risultato APPLICABILITY è assente.',
        false,
        1,
        'APPLICABILITY');
      const verdict = this.createEmptyVerdict(
        failure.category === 'INFRASTRUCTURE_FAILURE' ? 'PatchHashFailure' : 'ApplicabilityExecutionFailure',
        failure.category === 'INFRASTRUCTURE_FAILURE' ? `Patch Hash Failure: ${failure.message}` : `Applicability Execution Failure: ${failure.message}`
      );

      const snapshot = this.telemetryTracker.getSnapshot();
      const iterationRecord: IterationRecord = {
        iteration: 1,
        patchDiff,
        patchHash,
        isApplicable: false,
        verification: verdict,
        telemetry: snapshot,
        agentUsage: this.telemetryTracker.getIterationAgentUsage(),
        patchChanges: this.getPatchChanges(patchDiff),
        applyMode: 'NOT_APPLICABLE',
        fuzzyFallbackUsed: false,
        failure
      };
      return this.publishFinalState(
        this.createFailureState(params, failure, [iterationRecord], this.limits.maxIterations, patchDiff)
      );
    }

    try {
      assertApplicabilityResultInvariants(
        applicability
      );
    } catch (error: unknown) {
      const failure =
        this.toFailure(
          'PATCH_VALIDATION',
          'ORACLE_INVARIANT_FAILURE',
          error,
          false,
          1,
          'APPLICABILITY'
        );

      const verdict: VerificationVerdict = {
        ...this.createEmptyVerdict(
          'ApplicabilityInvariantFailure',
          `Applicability Invariant Failure: ${failure.message}`
        ),
        oracleResults: [
          applicability
        ]
      };

      const snapshot =
        this.telemetryTracker.getSnapshot();

      const iterationRecord:
        IterationRecord = {
        iteration: 1,
        patchDiff,
        patchHash,
        isApplicable: false,
        verification: verdict,
        telemetry: snapshot,
        agentUsage:
          this.telemetryTracker
            .getIterationAgentUsage(),
        patchChanges:
          this.getPatchChanges(
            patchDiff
          ),
        applyMode: 'NOT_APPLICABLE',
        fuzzyFallbackUsed: false,
        failure,
        technicalAttempts: 1
      };

      return this.publishFinalState(
        this.createFailureState(
          params,
          failure,
          [
            iterationRecord
          ],
          this.limits.maxIterations,
          patchDiff
        )
      );
    }

    this.telemetryTracker.recordOracleDuration(
      applicability.durationMs
    );

    const applicabilityRequirementFailure =
      this.validateApplicabilityRequirement(
        applicability,
        1
      );


    let verdict: VerificationVerdict = {
      ...this.createEmptyVerdict(),
      oracleResults: [applicability]
    };

    let baselineFailure: ExecutionFailure | undefined = applicabilityRequirementFailure ?? undefined;
    let applyMode: IterationRecord['applyMode'] = 'NOT_APPLICABLE';
    let patchApplicationAttempted = false;
    let baselineRequiredUnavailable = false;
    let fullVerificationCompleted = false;

    if (!baselineFailure) {
      if (applicability.status === 'EXECUTION_ERROR') {
        baselineFailure = this.toFailure('PATCH_VALIDATION', 'ORACLE_EXECUTION_FAILURE', applicability.summary, false, 1, 'APPLICABILITY');
      } else if (applicability.status === 'NOT_AVAILABLE') {
        baselineRequiredUnavailable = true;
      }
      else if (applicability.status === 'FAIL') {
        baselineFailure = this.toFailure('PATCH_VALIDATION', 'PATCH_NOT_APPLICABLE', applicability.summary, false, 1, 'APPLICABILITY');
      } else if (applicability.status === 'PASS') {
        const certifiedMode = applicability.evidence.applyMode;

        if (certifiedMode === 'NOT_APPLICABLE') {
          baselineFailure = this.toFailure('PATCH_VALIDATION', 'INFRASTRUCTURE_FAILURE', 'Applicability ha restituito PASS con applyMode NOT_APPLICABLE.', false, 1, 'APPLICABILITY');
        } else {
          const tApply = this.telemetryTracker.startCpuMeasurement();

          try {
            patchApplicationAttempted = true;
            applyMode = await this.gitManager.applyPatch(patchDiff, patchScope, certifiedMode);
          } catch (error: unknown) {
            baselineFailure = this.toFailure('PATCH_APPLICATION', 'PATCH_APPLICATION_FAILURE', error, false, 1, 'APPLICABILITY');
            verdict = {
              ...this.createEmptyVerdict('PatchApplyFailure', `Patch Application Failure: ${this.errorMessage(error)}`),
              oracleResults: [applicability]
            };
            applyMode = 'NOT_APPLICABLE';
            console.warn('[Baseline] Patch application failure:', baselineFailure);
          } finally {
            this.telemetryTracker.recordOrchestrationCpu(tApply);
          }

          if (!baselineFailure) {
            this.publishPhase(1, 'EVALUATION');
            try {
              const evaluation = await this.evaluateAppliedPatch(params, patchDiff);
              const evaluated = this.createVerificationVerdict(applicability, evaluation);
              verdict = evaluated.verdict;
              fullVerificationCompleted = true;

              if (evaluated.decision.hasInvariantViolation) {
                baselineFailure = this.toFailure('EVALUATION', 'ORACLE_INVARIANT_FAILURE', this.describeOracleInvariantViolation(evaluated.decision), false, 1);
              } else if (evaluated.decision.hasExecutionError) {
                const executionError = evaluated.decision.executionErrors[0];

                baselineFailure = this.toFailure('EVALUATION', 'ORACLE_EXECUTION_FAILURE', executionError?.summary ?? 'Un oracle non ha completato correttamente l’esecuzione.', false, 1, executionError?.oracle);
              }
            } catch (error: unknown) {
              baselineFailure = this.toFailure('EVALUATION', error instanceof VerificationInvariantError ? 'ORACLE_INVARIANT_FAILURE' : 'ORACLE_EXECUTION_FAILURE', error, false, 1);
            }
          }
        }
      }
    }
    if (patchApplicationAttempted) {
      const rollbackFailure = await this.safeRollback(1);

      if (rollbackFailure) {
        baselineFailure = rollbackFailure;
      }
    }

    const decision = fullVerificationCompleted ? decideOracleResults(verdict.oracleResults, DEFAULT_ORACLE_PROFILE) : null;

    const terminalResolution =
      this.resolveTerminalResolution({
        ...(baselineFailure !== undefined
          ? { failure: baselineFailure }
          : {}),
        ...(decision !== null
          ? { decision }
          : {}),
        requiredOracleUnavailable:
          baselineRequiredUnavailable,
        refinementBudgetExhausted: true
      });


    const snapshot = this.telemetryTracker.getSnapshot();

    const iterationRecord:
      IterationRecord = {
      iteration: 1,
      patchDiff,
      patchHash,
      isApplicable:
        applicability.status === 'PASS' &&
        applicability.evidence.applyMode !== 'NOT_APPLICABLE',
      verification: verdict,
      telemetry: snapshot,
      agentUsage: this.telemetryTracker.getIterationAgentUsage(),
      patchChanges: this.getPatchChanges(patchDiff),
      applyMode,
      fuzzyFallbackUsed:
        applyMode === 'FUZZY',
      technicalAttempts: 1,
      ...(baselineFailure
        ? {
          failure: baselineFailure
        }
        : {})
    };

    const terminationReason = describeTerminalState(
      terminalResolution,
      baselineFailure
    );

    const candidateVerified = verdict.verified === true;
    const autonomousRunSucceeded = candidateVerified && terminalResolution.status === 'CONVERGED';

    const finalState: WorkbenchSessionState = {
      taskId: this.taskId,
      issueSpec: params.issueSpec,
      category: params.category,
      status: terminalResolution.status,
      autonomousStatus: terminalResolution.status,
      finalizationStatus: 'NOT_FINALIZED',
      candidateVerified,
      autonomousRunSucceeded,
      targetFiles: params.targetFiles,
      testFiles: params.testFiles,
      currentIteration: 1,
      maxIterations: this.limits.maxIterations,
      iterations: [iterationRecord],
      finalPatch: patchDiff,
      cumulativeTelemetry:
        snapshot,
      ...(baselineFailure
        ? {
          failure: baselineFailure
        }
        : {}),
      ...(this.initialHead
        ? {
          initialHead: this.initialHead
        }
        : {}),
      ...(this.rollbackResult
        ? {
          rollbackResult: this.rollbackResult
        }
        : {}),
      terminationReason
    };

    return this.publishFinalState(finalState);
  }

  public async runLoop(params: InitialContextParams): Promise<WorkbenchSessionState> {
    const transactionFailure = await this.initializeTransaction(0);
    if (transactionFailure) {
      return this.publishFinalState(this.createFailureState(params, transactionFailure, [], this.limits.maxIterations));
    }
    const patchScope: PatchScope = {
      category: params.category,
      targetFiles: params.targetFiles,
      testFiles: params.testFiles
    };

    const iterations: IterationRecord[] = [];
    const cumulativeRemediations = new Map<string, CumulativeRemediation>();
    const seenApplicablePatchHashes = new Set<string>();
    let terminalFailure: ExecutionFailure | undefined;
    let currentPayload: string = '';
    let initialPayloadFailure: ExecutionFailure | undefined;
    let terminalResolution: TerminalStateResolution | undefined;
    let lastOracleEvaluatedPatch: string | undefined;
    const tInitialPayload = this.telemetryTracker.startCpuMeasurement();

    try {
      currentPayload = await this.contextBuilder.buildInitialPayload(params);
    } catch (error: unknown) {
      initialPayloadFailure = this.toFailure('INITIALIZATION', 'CONTEXT_BUILD_FAILURE', error, false, 0);
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tInitialPayload);
    }

    if (initialPayloadFailure) {
      terminalFailure = initialPayloadFailure;

      return this.publishFinalState(
        this.createFailureState(
          params,
          terminalFailure,
          [],
          this.limits.maxIterations
        )
      );
    }

    for (let iteration = 1; iteration <= this.limits.maxIterations; iteration++) {
      this.telemetryTracker.startIteration();
      this.publishPhase(iteration, 'INSPECTION');

      let iterationFailure: ExecutionFailure | undefined;
      let generatedPatch: ApplicablePatchGeneration;

      try {
        generatedPatch = await this.generateApplicablePatch(currentPayload, params, patchScope, iteration);
      } catch (error: unknown) {
        if (!(error instanceof CoderPatchGenerationError)) {
          const isOracleInvariantFailure = error instanceof VerificationInvariantError;
          terminalFailure = this.toFailure(
            isOracleInvariantFailure ? 'PATCH_VALIDATION' : 'INSPECTION',
            isOracleInvariantFailure ? 'ORACLE_INVARIANT_FAILURE' : 'UNKNOWN_FAILURE',
            error,
            false,
            iteration,
            isOracleInvariantFailure ? 'APPLICABILITY' : undefined
          );

          terminalResolution = this.resolveTerminalResolution({
            failure: terminalFailure,
            refinementBudgetExhausted: true
          });

          break;
        }
        const generationError = error.message;
        iterationFailure = this.toFailure('INSPECTION', error.category, error, iteration < this.limits.maxIterations, iteration);
        console.warn(`[Iteration ${iteration}] Patch generation failure:`, generationError);

        const failureDescriptor = error.category === 'DIFF_EXTRACTION_FAILURE' ? {
          testName: 'DiffFormatFailure',
          message: `Diff Extraction Failure: ${generationError}`
        } : error.category === 'MODEL_GENERATION_FAILURE' ? {
          testName: 'ModelGenerationFailure',
          message: `Model Generation Failure: ${generationError}`
        } : {
          testName: 'UnknownFailure',
          message: `Unknown Coder Failure: ${generationError}`
        };
        const failureVerdict = this.createEmptyVerdict(
          failureDescriptor.testName,
          failureDescriptor.message
        );

        if (iteration < this.limits.maxIterations) {
          this.publishPhase(iteration, 'REFINEMENT');

          const feedback: ReviewerFeedbackPayload = {
            rootCauseSummary: params.category === 'CREATE'
              ? 'Patch generation failed. Produce one valid complete Unified Diff for the requested CREATE operation. Existing target files may be modified and required source files may be created. Protected test files must remain unchanged.'
              : 'Patch generation failed. Produce one valid complete Unified Diff against the authoritative original target files. Protected test files must remain unchanged.',
            violationsPrunedCount: 0,
            targetRemediations: [
              {
                file: params.targetFiles[0] ?? 'unknown',
                lineRange: {
                  start: 1,
                  end: 1
                },
                rootCause: generationError,
                mandatoryCorrection: params.category === 'CREATE'
                  ? 'Regenerate one syntactically valid complete Unified Diff. Use standard headers for existing files and /dev/null headers for new files. Preserve protected test files.'
                  : 'Regenerate one syntactically valid complete Unified Diff against the authoritative original source. Use exact original context and removed lines.'
              }
            ],
            securityPriorityStrict: true,
            flappingDetected: false
          };

          const cumulativeSnapshot = this.mergeCumulativeRemediations(cumulativeRemediations, feedback, iteration);

          iterations.push({
            iteration,
            patchDiff: '',
            patchHash: '',
            isApplicable: false,
            verification: failureVerdict,
            reviewerFeedback: feedback,
            reviewerMode: 'ORCHESTRATOR',
            telemetry: this.telemetryTracker.getSnapshot(),
            agentUsage: this.telemetryTracker.getIterationAgentUsage(),
            patchChanges: this.getPatchChanges(''),
            applyMode: 'NOT_APPLICABLE',
            fuzzyFallbackUsed: false,
            failure: iterationFailure,
            cumulativeRemediations: cumulativeSnapshot
          });

          const tRefinementContext = this.telemetryTracker.startCpuMeasurement();
          let refinementContextFailure: ExecutionFailure | undefined;

          try {
            currentPayload = this.contextBuilder.buildRefinementPayload({
              iteration: iteration + 1,
              ...(lastOracleEvaluatedPatch !== undefined ? { previousCandidatePatch: lastOracleEvaluatedPatch } : {}),
              currentFeedback: feedback,
              cumulativeRemediations: cumulativeSnapshot,
              currentFailure: iterationFailure?.message ?? feedback.rootCauseSummary
            });
          } catch (error: unknown) {
            refinementContextFailure = this.toFailure(
              'REFINEMENT',
              'REFINEMENT_CONTEXT_FAILURE',
              error,
              false,
              iteration
            );
          } finally {
            this.telemetryTracker.recordOrchestrationCpu(tRefinementContext);
          }
          if (refinementContextFailure) {
            terminalFailure = refinementContextFailure;

            this.refreshLatestIterationTelemetry(iterations);
            terminalResolution = this.resolveTerminalResolution({
              failure: terminalFailure,
              refinementBudgetExhausted:
                true
            });

            break;
          }

          continue;
        }

        iterations.push({
          iteration,
          patchDiff: '',
          patchHash: '',
          isApplicable: false,
          verification: failureVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(''),
          applyMode: 'NOT_APPLICABLE',
          fuzzyFallbackUsed: false,
          failure: iterationFailure,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations)
        });
        terminalFailure = iterationFailure;
        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          refinementBudgetExhausted: true
        });
        break;
      }

      const {
        patchDiff,
        patchHash,
        applicability,
        technicalAttempts
      } = generatedPatch;

      console.log(`[Iteration ${iteration}] Applicability completed after ${technicalAttempts} technical attempt(s).`);
      const applicabilityVerdict: VerificationVerdict = {
        ...this.createEmptyVerdict('ApplicabilityFailure', applicability.summary),
        oracleResults: [applicability]
      };
      const applicabilityRequirementFailure = this.validateApplicabilityRequirement(applicability, iteration);
      if (applicabilityRequirementFailure) {
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: false,
          verification: applicabilityVerdict,
          telemetry:
            this.telemetryTracker.getSnapshot(),
          agentUsage:
            this.telemetryTracker
              .getIterationAgentUsage(),
          patchChanges:
            this.getPatchChanges(patchDiff),
          applyMode: 'NOT_APPLICABLE',
          fuzzyFallbackUsed: false,
          failure: applicabilityRequirementFailure,
          cumulativeRemediations:
            this.getCumulativeRemediations(
              cumulativeRemediations
            ),
          technicalAttempts
        });

        terminalFailure = applicabilityRequirementFailure;

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          refinementBudgetExhausted: true
        });

        break;
      }
      if (applicability.status === 'EXECUTION_ERROR') {
        iterationFailure = this.toFailure('PATCH_VALIDATION', 'ORACLE_EXECUTION_FAILURE', applicability.summary, false, iteration, 'APPLICABILITY');
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: false,
          verification: applicabilityVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode: 'NOT_APPLICABLE',
          fuzzyFallbackUsed: false,
          failure: iterationFailure,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        terminalFailure = iterationFailure;

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          refinementBudgetExhausted: true
        });

        break;
      }
      if (applicability.status === 'NOT_AVAILABLE') {
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: false,
          verification: applicabilityVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode: 'NOT_APPLICABLE',
          fuzzyFallbackUsed: false,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        terminalResolution = this.resolveTerminalResolution({
          requiredOracleUnavailable: true,
          refinementBudgetExhausted: true
        });
        break;
      }
      if (
        applicability.status === 'FAIL'
      ) {
        iterationFailure =
          this.toFailure(
            'PATCH_VALIDATION',
            'PATCH_NOT_APPLICABLE',
            applicability.summary,
            false,
            iteration,
            'APPLICABILITY'
          );

        console.warn(
          `[Iteration ${iteration}] ` +
          `Patch non applicabile dopo ` +
          `${technicalAttempts} tentativi tecnici.`
        );

        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: false,
          verification:
            applicabilityVerdict,
          telemetry:
            this.telemetryTracker
              .getSnapshot(),
          agentUsage:
            this.telemetryTracker
              .getIterationAgentUsage(),
          patchChanges:
            this.getPatchChanges(
              patchDiff
            ),
          applyMode:
            'NOT_APPLICABLE',
          fuzzyFallbackUsed:
            false,
          failure:
            iterationFailure,
          cumulativeRemediations:
            this.getCumulativeRemediations(
              cumulativeRemediations
            ),
          technicalAttempts
        });

        terminalFailure =
          iterationFailure;

        terminalResolution =
          this.resolveTerminalResolution({
            failure:
              terminalFailure,
            refinementBudgetExhausted:
              false
          });

        break;
      }

      const certifiedApplyMode = applicability.evidence.applyMode;

      if (certifiedApplyMode === 'NOT_APPLICABLE') {
        iterationFailure = this.toFailure('PATCH_VALIDATION', 'INFRASTRUCTURE_FAILURE', 'Applicability ha restituito PASS con applyMode NOT_APPLICABLE.', false, iteration, 'APPLICABILITY');
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: false,
          verification: applicabilityVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode: 'NOT_APPLICABLE',
          fuzzyFallbackUsed: false,
          failure: iterationFailure,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        terminalFailure = iterationFailure;

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          refinementBudgetExhausted: true
        });

        break;
      }

      const flappingDetected = seenApplicablePatchHashes.has(patchHash);
      seenApplicablePatchHashes.add(patchHash);
      if (flappingDetected && cumulativeRemediations.size > 0) {
        const repeatedPatchMessage = 'La patch applicabile generata è identica a una patch candidata già valutata e non dimostra di avere incorporato il feedback cumulativo.';
        iterationFailure = this.toFailure('REFINEMENT', 'REFINEMENT_STAGNATION', repeatedPatchMessage, iteration < this.limits.maxIterations, iteration);
        const failureVerdict:
          VerificationVerdict = {
          ...this.createEmptyVerdict(
            'RepeatedPatch',
            repeatedPatchMessage
          ),
          oracleResults: [
            applicability
          ]
        };
        const existingRemediations = this.getCumulativeRemediations(cumulativeRemediations);
        const feedback: ReviewerFeedbackPayload = {
          rootCauseSummary: repeatedPatchMessage,
          violationsPrunedCount: 0,
          targetRemediations: existingRemediations.map((entry) => entry.remediation),
          securityPriorityStrict: true,
          flappingDetected: true
        };
        const cumulativeSnapshot = this.mergeCumulativeRemediations(cumulativeRemediations, feedback, iteration);
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: failureVerdict,
          reviewerFeedback: feedback,
          reviewerMode: 'ORCHESTRATOR',
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode: certifiedApplyMode,
          fuzzyFallbackUsed: certifiedApplyMode === 'FUZZY',
          failure: iterationFailure,
          cumulativeRemediations: cumulativeSnapshot,
          technicalAttempts
        });
        if (iteration >= this.limits.maxIterations) {
          terminalFailure = iterationFailure;

          terminalResolution = this.resolveTerminalResolution({
            failure: terminalFailure,
            refinementBudgetExhausted: true
          });

          break;
        }
        const tRefinementContext = this.telemetryTracker.startCpuMeasurement();
        let refinementContextFailure: ExecutionFailure | undefined;
        try {
          currentPayload = this.contextBuilder.buildRefinementPayload({
            iteration: iteration + 1,
            ...(lastOracleEvaluatedPatch !== undefined ? { previousCandidatePatch: lastOracleEvaluatedPatch } : {}),
            currentFeedback: feedback,
            cumulativeRemediations: cumulativeSnapshot,
            currentFailure: repeatedPatchMessage
          });
        } catch (refinementError: unknown) {
          refinementContextFailure = this.toFailure(
            'REFINEMENT',
            'REFINEMENT_CONTEXT_FAILURE',
            refinementError,
            false,
            iteration
          );
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tRefinementContext);
        }
        if (refinementContextFailure) {
          terminalFailure = refinementContextFailure;

          this.refreshLatestIterationTelemetry(iterations);

          terminalResolution = this.resolveTerminalResolution({
            failure: terminalFailure,
            refinementBudgetExhausted: true
          });

          break;
        }

        continue;
      }
      let applyMode: IterationRecord['applyMode'] = 'NOT_APPLICABLE';
      const tApply = this.telemetryTracker.startCpuMeasurement();
      try {
        applyMode = await this.gitManager.applyPatch(patchDiff, patchScope, certifiedApplyMode);
      } catch (error: unknown) {
        iterationFailure = this.toFailure('PATCH_APPLICATION', 'PATCH_APPLICATION_FAILURE', error, false, iteration, 'APPLICABILITY');
      } finally {
        this.telemetryTracker.recordOrchestrationCpu(tApply);
      }

      if (iterationFailure) {
        const failureVerdict: VerificationVerdict = {
          ...this.createEmptyVerdict('PatchApplyFailure', `Patch Application Failure: ${iterationFailure.message}`),
          oracleResults: [applicability]
        };
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: false,
          verification: failureVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode: 'NOT_APPLICABLE',
          fuzzyFallbackUsed: false,
          failure: iterationFailure,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        terminalFailure = iterationFailure;

        const rollbackFailure =
          await this.safeRollback(iteration);

        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
        }

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          refinementBudgetExhausted: true
        });

        break;
      }

      this.publishPhase(iteration, 'EVALUATION');
      let verdict: VerificationVerdict;
      let decision: OracleDecision;
      try {
        const evaluation = await this.evaluateAppliedPatch(params, patchDiff);
        const evaluated = this.createVerificationVerdict(applicability, evaluation);
        verdict = evaluated.verdict;
        decision = evaluated.decision;
      } catch (error: unknown) {
        iterationFailure = this.toFailure('EVALUATION', error instanceof VerificationInvariantError ? 'ORACLE_INVARIANT_FAILURE' : 'ORACLE_EXECUTION_FAILURE', error, false, iteration);
        const failureVerdict: VerificationVerdict = {
          ...this.createEmptyVerdict('OracleExecutionFailure', `Oracle Execution Failure: ${this.errorMessage(error)}`),
          oracleResults: [applicability]
        };

        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: failureVerdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY',
          failure: iterationFailure,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        terminalFailure = iterationFailure;

        const rollbackFailure =
          await this.safeRollback(iteration);

        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
        }

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          refinementBudgetExhausted: true
        });

        break;
      }

      if (decision.hasInvariantViolation) {
        iterationFailure = this.toFailure(
          'EVALUATION',
          'ORACLE_INVARIANT_FAILURE',
          this.describeOracleInvariantViolation(
            decision
          ),
          false,
          iteration
        );

        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry:
            this.telemetryTracker.getSnapshot(),
          agentUsage:
            this.telemetryTracker
              .getIterationAgentUsage(),
          patchChanges:
            this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed:
            applyMode === 'FUZZY',
          failure: iterationFailure,
          cumulativeRemediations:
            this.getCumulativeRemediations(
              cumulativeRemediations
            ),
          technicalAttempts
        });

        terminalFailure = iterationFailure;

        const rollbackFailure =
          await this.safeRollback(iteration);

        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
        }

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          decision,
          refinementBudgetExhausted: true
        });
        break;
      }

      if (!decision.hasExecutionError && !decision.hasRequiredUnavailable) {
        lastOracleEvaluatedPatch = patchDiff;
      }

      if (decision.hasExecutionError) {
        const executionError = decision.executionErrors[0];
        iterationFailure = this.toFailure('EVALUATION', 'ORACLE_EXECUTION_FAILURE', executionError?.summary ?? 'Un oracle non ha completato correttamente l’esecuzione.', false, iteration, executionError?.oracle);
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY',
          failure: iterationFailure,
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        terminalFailure = iterationFailure;
        const rollbackFailure = await this.safeRollback(iteration);
        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
        }

        terminalResolution = this.resolveTerminalResolution({
          failure: terminalFailure,
          decision,
          refinementBudgetExhausted: true
        });
        break;
      }

      if (decision.hasRequiredUnavailable) {
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY',
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });
        const rollbackFailure = await this.safeRollback(iteration);
        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
        }
        terminalResolution = this.resolveTerminalResolution({
          ...(terminalFailure !== undefined
            ? { failure: terminalFailure }
            : {}),
          decision,
          refinementBudgetExhausted: true
        });
        break;
      }
      const currentSnapshot = this.telemetryTracker.getSnapshot();

      this.ssePublisher?.({
        type: 'TELEMETRY_UPDATE',
        payload: {
          promptTokens: currentSnapshot.promptTokens,
          completionTokens: currentSnapshot.completionTokens,
          tokenUsageAvailable: currentSnapshot.tokenUsageAvailable,
          durationMs: currentSnapshot.totalDurationMs
        }
      });

      if (decision.converged) {
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY',
          cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
          technicalAttempts
        });

        const rollbackFailure = await this.safeRollback(iteration);
        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
        }

        terminalResolution = this.resolveTerminalResolution({
          ...(terminalFailure !== undefined
            ? { failure: terminalFailure }
            : {}),
          decision,
          refinementBudgetExhausted: false
        });

        break;
      }

      if (decision.shouldRefine && iteration < this.limits.maxIterations) {
        this.publishPhase(iteration, 'REFINEMENT');
        const tReviewerCpu = this.telemetryTracker.startCpuMeasurement();
        let reviewResult: Awaited<ReturnType<ReviewerAgent['review']>> | undefined;
        let reviewerFailure: ExecutionFailure | undefined;

        try {
          const buildSyntaxResult = verdict.oracleResults.find((result): result is OracleResult<'BUILD_SYNTAX'> => result.oracle === 'BUILD_SYNTAX');

          if (!buildSyntaxResult) {
            throw new Error(
              'Il verdetto non contiene il risultato BUILD_SYNTAX richiesto.'
            );
          }

          reviewResult = await this.reviewer.review({
            buildSyntax: buildSyntaxResult,
            sastFindings: verdict.sastFindings,
            testReport: verdict.testReport,
            flappingDetected,
            targetFiles: params.targetFiles,
            testFiles: params.testFiles,
            category: params.category
          });

          if (reviewResult === undefined) {
            throw new Error('Invariante interna violata: risultato Reviewer assente dopo una review completata');
          }

          if (reviewResult.reviewerMode !== 'LLM' && reviewResult.reviewerMode !== 'DETERMINISTIC_FALLBACK') {
            throw new Error(
              'Il Reviewer ha restituito una modalità di provenienza non valida.'
            );
          }

          if (reviewResult.reviewerMode === 'DETERMINISTIC_FALLBACK' && (
            reviewResult.fallbackReason === undefined ||
            reviewResult.fallbackReason.trim().length === 0
          )) {
            throw new Error(
              'Il Reviewer fallback non ha fornito fallbackReason.'
            );
          }
          if (
            reviewResult.reviewerMode === 'LLM' &&
            reviewResult.fallbackReason !== undefined
          ) {
            throw new Error(
              'Il Reviewer LLM non può dichiarare fallbackReason.'
            );
          }
        } catch (error: unknown) {
          reviewerFailure =
            this.toFailure(
              'REVIEW',
              'REVIEWER_FAILURE',
              error,
              false,
              iteration
            );
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tReviewerCpu);
        }

        if (reviewerFailure !== undefined || reviewResult === undefined) {
          const effectiveReviewerFailure = reviewerFailure ??
            this.toFailure(
              'REVIEW',
              'REVIEWER_FAILURE',
              'Invariante interna violata: risultato Reviewer assente dopo una review completata',
              false,
              iteration
            );

          iterationFailure = effectiveReviewerFailure;
          terminalFailure = effectiveReviewerFailure;

          iterations.push({
            iteration,
            patchDiff,
            patchHash,
            isApplicable: true,
            verification: verdict,
            telemetry: this.telemetryTracker.getSnapshot(),
            agentUsage: this.telemetryTracker.getIterationAgentUsage(),
            patchChanges: this.getPatchChanges(patchDiff),
            applyMode,
            fuzzyFallbackUsed: applyMode === 'FUZZY',
            failure: effectiveReviewerFailure,
            cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
            technicalAttempts
          });

          const rollbackFailure = await this.safeRollback(iteration);

          if (rollbackFailure) {
            terminalFailure = rollbackFailure;
          }

          this.refreshLatestIterationTelemetry(iterations);

          terminalResolution = this.resolveTerminalResolution({
            failure: terminalFailure,
            decision,
            refinementBudgetExhausted: true
          });

          break;
        }

        const {
          feedback,
          reviewerMode,
          fallbackReason
        } =
          reviewResult;

        const cumulativeSnapshot = this.mergeCumulativeRemediations(cumulativeRemediations, feedback, iteration);
        iterations.push({
          iteration,
          patchDiff,
          patchHash,
          isApplicable: true,
          verification: verdict,
          reviewerFeedback: feedback,
          reviewerMode,
          ...(fallbackReason !== undefined
            ? {
              fallbackReason
            }
            : {}),
          telemetry: this.telemetryTracker.getSnapshot(),
          agentUsage: this.telemetryTracker.getIterationAgentUsage(),
          patchChanges: this.getPatchChanges(patchDiff),
          applyMode,
          fuzzyFallbackUsed: applyMode === 'FUZZY',
          cumulativeRemediations: cumulativeSnapshot,
          technicalAttempts
        });

        const rollbackFailure = await this.safeRollback(iteration);
        if (rollbackFailure) {
          terminalFailure = rollbackFailure;
          this.refreshLatestIterationTelemetry(iterations);
          terminalResolution = this.resolveTerminalResolution({
            failure: terminalFailure,
            decision,
            refinementBudgetExhausted: true
          });
          break;
        }

        const tRefinementContext = this.telemetryTracker.startCpuMeasurement();
        let refinementContextFailure: ExecutionFailure | undefined;
        try {
          currentPayload = this.contextBuilder.buildRefinementPayload({
            iteration: iteration + 1,
            previousCandidatePatch: patchDiff,
            currentFeedback: feedback,
            cumulativeRemediations: cumulativeSnapshot,
            currentFailure: feedback.rootCauseSummary,
          });
        } catch (error: unknown) {
          refinementContextFailure = this.toFailure('REFINEMENT', 'REFINEMENT_CONTEXT_FAILURE', error, false, iteration);
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tRefinementContext);
        }
        if (refinementContextFailure) {
          terminalFailure = refinementContextFailure;
          this.refreshLatestIterationTelemetry(iterations);
          terminalResolution = this.resolveTerminalResolution({
            failure: terminalFailure,
            decision,
            refinementBudgetExhausted: true
          });

          break;
        }

        continue;
      }
      iterations.push({
        iteration,
        patchDiff,
        patchHash,
        isApplicable: true,
        verification: verdict,
        telemetry: this.telemetryTracker.getSnapshot(),
        agentUsage: this.telemetryTracker.getIterationAgentUsage(),
        patchChanges: this.getPatchChanges(patchDiff),
        applyMode,
        fuzzyFallbackUsed: applyMode === 'FUZZY',
        cumulativeRemediations: this.getCumulativeRemediations(cumulativeRemediations),
        technicalAttempts
      });

      const rollbackFailure = await this.safeRollback(iteration);
      if (rollbackFailure) {
        terminalFailure = rollbackFailure;
      }
      terminalResolution = this.resolveTerminalResolution({
        ...(terminalFailure !== undefined
          ? { failure: terminalFailure }
          : {}),
        decision,
        refinementBudgetExhausted:
          iteration >= this.limits.maxIterations
      });
      break;
    }
    const resolvedTerminalState = terminalResolution ?? this.resolveTerminalResolution({});
    const candidateVerified = iterations.at(-1)?.verification.verified === true;
    const autonomousRunSucceeded = candidateVerified && resolvedTerminalState.status === 'CONVERGED';

    const state: WorkbenchSessionState = {
      taskId: this.taskId,
      issueSpec: params.issueSpec,
      category: params.category,
      status: resolvedTerminalState.status,
      autonomousStatus: resolvedTerminalState.status,
      finalizationStatus: 'NOT_FINALIZED',
      candidateVerified,
      autonomousRunSucceeded,
      targetFiles: params.targetFiles,
      testFiles: params.testFiles,
      currentIteration: iterations.length,
      maxIterations: this.limits.maxIterations,
      iterations,
      finalPatch: iterations[iterations.length - 1]?.patchDiff,
      cumulativeTelemetry: this.telemetryTracker.getSnapshot(),
      ...(terminalFailure ? { failure: terminalFailure } : {}),
      ...(this.initialHead ? { initialHead: this.initialHead } : {}),
      ...(this.rollbackResult ? { rollbackResult: this.rollbackResult } : {}),
      terminationReason: describeTerminalState(resolvedTerminalState, terminalFailure)
    };

    return this.publishFinalState(state);
  }

  private refreshLatestIterationTelemetry(iterations: IterationRecord[]): void {
    const lastIndex = iterations.length - 1;

    if (lastIndex < 0) {
      return;
    }

    const current = iterations[lastIndex];

    if (!current) {
      return;
    }

    iterations[lastIndex] = {
      ...current,
      telemetry: this.telemetryTracker.getSnapshot(),
      agentUsage: this.telemetryTracker.getIterationAgentUsage()
    };
  }

  private createRemediationKey(remediation: TargetRemediation): string {
    const normalizedFile = remediation.file.replaceAll('\\', '/').trim().toLowerCase();
    const normalizedRule = remediation.relatedRuleId?.trim().toLowerCase() ?? '';
    const normalizedCorrection = remediation.mandatoryCorrection.trim().toLowerCase().replace(/\s+/g, ' ');

    return [
      normalizedFile,
      normalizedRule,
      normalizedCorrection
    ].join('|');
  }

  private mergeCumulativeRemediations(cumulativeRemediations: Map<string, CumulativeRemediation>, feedback: ReviewerFeedbackPayload, iteration: number): readonly CumulativeRemediation[] {
    for (const remediation of feedback.targetRemediations) {
      const key = this.createRemediationKey(remediation);
      const existing = cumulativeRemediations.get(key);
      if (existing) {
        cumulativeRemediations.set(key, {
          ...existing,
          remediation,
          lastObservedIteration: iteration,
          observationCount: existing.observationCount + 1
        });

        continue;
      }

      cumulativeRemediations.set(key, {
        key,
        remediation,
        firstObservedIteration: iteration,
        lastObservedIteration: iteration,
        observationCount: 1
      });
    }

    return this.getCumulativeRemediations(cumulativeRemediations);
  }

  private getCumulativeRemediations(cumulativeRemediations: ReadonlyMap<string, CumulativeRemediation>): readonly CumulativeRemediation[] {
    return [...cumulativeRemediations.values()].sort((left, right) => {
      if (left.firstObservedIteration !== right.firstObservedIteration) {
        return (left.firstObservedIteration - right.firstObservedIteration);
      }

      return left.key.localeCompare(right.key);
    });
  }

  private async evaluateAppliedPatch(
    params: InitialContextParams,
    patchDiff: string
  ): Promise<AppliedPatchEvaluation> {
    const tBuildCpu = this.telemetryTracker.startCpuMeasurement();

    let buildSyntax: OracleResult<'BUILD_SYNTAX'>;

    try {
      buildSyntax = await this.buildSyntaxOracle.evaluate({
        ...(params.buildOracleConfig !== undefined
          ? {
            config: params.buildOracleConfig
          }
          : {}),
        required: true
      });
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tBuildCpu);
    }

    assertBuildSyntaxResultInvariants(buildSyntax);
    this.telemetryTracker.recordOracleDuration(buildSyntax.durationMs);

    this.publishOracleProgress(
      'BUILD_SYNTAX',
      buildSyntax.status === 'PASS' ||
      buildSyntax.status === 'FAIL',
      buildSyntax.status === 'FAIL' ? 1 : 0
    );

    if (buildSyntax.status === 'FAIL') {
      const blockedSemgrep:
        OracleResult<'SEMGREP'> = {
        oracle: 'SEMGREP',
        status: 'BLOCKED',
        required: true,
        durationMs: 0,
        summary:
          'Semgrep non eseguito perché ' +
          'BUILD_SYNTAX ha rilevato un ' +
          'candidato sintatticamente invalido.',
        blockedBy: 'BUILD_SYNTAX',
        blockedReason:
          buildSyntax.summary,
        evidence: {
          findings: [],
          scannedFiles: []
        }
      };

      const blockedFunctionalTest:
        OracleResult<'FUNCTIONAL_TEST'> = {
        oracle: 'FUNCTIONAL_TEST',
        status: 'BLOCKED',
        required: true,
        durationMs: 0,
        summary:
          'Test funzionali non eseguiti ' +
          'perché BUILD_SYNTAX ha rilevato ' +
          'un candidato sintatticamente ' +
          'invalido.',
        blockedBy: 'BUILD_SYNTAX',
        blockedReason:
          buildSyntax.summary,
        evidence: {
          report: {
            oracleStatus: 'BLOCKED',
            command: null,
            args: [],
            cwd: null,
            timeoutMs: null,
            envAllowList: [],
            oracleFilesExecuted: [],
            implicitDiscoveryUsed: false,
            expectedExitPolicy: null,
            exitCode: null,
            suitePassed: false,
            timedOut: false,
            oracleFailed: false,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            skippedTests: 0,
            xfailedTests: 0,
            xpassedTests: 0,
            errorTests: 0,
            passRate: 0,
            durationMs: 0,
            failureDetails: [],
            stdout: '',
            stderr: '',
            rawStdout: '',
            rawStderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            executionDurationMs: 0
          }
        }
      };

      return {
        oracleResults: [
          buildSyntax,
          blockedSemgrep,
          blockedFunctionalTest
        ],
        buildSyntax,
        semgrep: blockedSemgrep,
        functionalTest:
          blockedFunctionalTest
      };
    }

    const tSemgrepCpu = this.telemetryTracker.startCpuMeasurement();

    let semgrep: OracleResult<'SEMGREP'>;

    try {
      semgrep = await this.semgrep.evaluate({
        targetFiles: params.targetFiles,
        patchDiff,
        category: params.category,
        required: true
      });
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tSemgrepCpu);
    }
    assertSemgrepResultInvariants(semgrep);
    this.telemetryTracker.recordOracleDuration(semgrep.durationMs);

    this.publishOracleProgress(
      'SEMGREP',
      semgrep.status === 'PASS' ||
      semgrep.status === 'FAIL',
      semgrep.evidence.findings.length
    );

    const tFunctionalCpu = this.telemetryTracker.startCpuMeasurement();

    let functionalTest: OracleResult<'FUNCTIONAL_TEST'>;

    try {
      functionalTest = await this.testHarness.evaluate({
        ...(params.functionalTestOracleConfig !== undefined
          ? {
            config: params.functionalTestOracleConfig
          }
          : {}),
        required: true
      });
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tFunctionalCpu);
    }
    assertFunctionalTestResultInvariants(functionalTest);
    this.telemetryTracker.recordOracleDuration(functionalTest.durationMs);

    this.publishOracleProgress(
      'TEST_HARNESS',
      functionalTest.status === 'PASS' ||
      functionalTest.status === 'FAIL',
      functionalTest.evidence.report.failedTests
    );

    const oracleResults: readonly OracleResult[] = [
      buildSyntax,
      semgrep,
      functionalTest
    ];

    return {
      oracleResults,
      buildSyntax,
      semgrep,
      functionalTest
    };
  }

  private async generateApplicablePatch(semanticPayload: string, params: InitialContextParams, patchScope: PatchScope, semanticIteration: number): Promise<ApplicablePatchGeneration> {
    let generationPayload = semanticPayload;
    let lastPatchDiff = '';
    let lastPatchHash = '';
    let lastApplicability: OracleResult<'APPLICABILITY'> | undefined;
    for (let technicalAttempt = 1; technicalAttempt <= this.limits.maxTechnicalAttempts; technicalAttempt++) {
      const tCodeCpu = this.telemetryTracker.startCpuMeasurement();
      try {
        lastPatchDiff = await this.coder.generatePatch(generationPayload, params.targetFiles, params.testFiles, params.category);
      } catch (error: unknown) {
        const category = this.classifyTypedCoderFailure(error);
        if (category === null) {
          throw error;
        }
        throw new CoderPatchGenerationError(this.errorMessage(error), category);
      } finally {
        this.telemetryTracker.recordOrchestrationCpu(tCodeCpu);
      }
      lastPatchHash = this.gitManager.computePatchHash(lastPatchDiff);
      console.log(`[Iteration ${semanticIteration}, technical attempt ${technicalAttempt}] GENERATED PATCH:\n${lastPatchDiff}`);
      const tApplicability = this.telemetryTracker.startCpuMeasurement();

      try {
        lastApplicability = await this.gitManager.evaluateApplicability(lastPatchDiff, patchScope, true);
      } finally {
        this.telemetryTracker.recordOrchestrationCpu(tApplicability);
      }
      assertApplicabilityResultInvariants(lastApplicability);
      this.telemetryTracker.recordOracleDuration(lastApplicability.durationMs);

      if (lastApplicability.status === 'PASS' || lastApplicability.status === 'EXECUTION_ERROR' || lastApplicability.status === 'NOT_AVAILABLE') {
        return {
          patchDiff: lastPatchDiff,
          patchHash: lastPatchHash,
          applicability: lastApplicability,
          technicalAttempts: technicalAttempt
        };
      }
      const tNormalization = this.telemetryTracker.startCpuMeasurement();
      let normalizedPatch: string | null;
      try {
        normalizedPatch = await this.gitManager.normalizeRejectedPatch(lastPatchDiff, patchScope);
      } finally {
        this.telemetryTracker.recordOrchestrationCpu(tNormalization);
      }

      if (normalizedPatch !== null) {
        const normalizedPatchHash = this.gitManager.computePatchHash(normalizedPatch);
        const tNormalizedApplicability = this.telemetryTracker.startCpuMeasurement();
        let normalizedApplicability: OracleResult<'APPLICABILITY'>;
        try {
          normalizedApplicability = await this.gitManager.evaluateApplicability(normalizedPatch, patchScope, true);
        } finally {
          this.telemetryTracker.recordOrchestrationCpu(tNormalizedApplicability);
        }
        assertApplicabilityResultInvariants(normalizedApplicability);
        this.telemetryTracker.recordOracleDuration(normalizedApplicability.durationMs);
        console.info(`[Iteration ${semanticIteration}, technical attempt ${technicalAttempt}] Normalized patch applicability: ${normalizedApplicability.status}.`);
        if (normalizedApplicability.status === 'PASS' || normalizedApplicability.status === 'EXECUTION_ERROR' || normalizedApplicability.status === 'NOT_AVAILABLE') {
          return {
            patchDiff: normalizedPatch,
            patchHash: normalizedPatchHash,
            applicability: normalizedApplicability,
            technicalAttempts: technicalAttempt
          };
        }
        lastPatchDiff = normalizedPatch;
        lastPatchHash = normalizedPatchHash;
        lastApplicability = normalizedApplicability;
      }
      if (technicalAttempt < this.limits.maxTechnicalAttempts) {
        generationPayload = this.contextBuilder.buildTechnicalRetryPayload(semanticPayload, lastPatchDiff, lastApplicability.summary, technicalAttempt + 1);
        console.warn(`[Iteration ${semanticIteration}] Applicability FAIL. Retry tecnico ${technicalAttempt + 1}/ ${this.limits.maxTechnicalAttempts}.`);
      }
    }
    if (!lastApplicability) {
      throw new Error('La generazione della patch non ha prodotto un risultato di Applicability.');
    }
    return {
      patchDiff: lastPatchDiff,
      patchHash: lastPatchHash,
      applicability: lastApplicability,
      technicalAttempts: this.limits.maxTechnicalAttempts
    };
  }


  private createVerificationVerdict(applicability: OracleResult<'APPLICABILITY'>, evaluation: AppliedPatchEvaluation): {
    readonly verdict: VerificationVerdict;
    readonly decision: OracleDecision;
  } {
    const oracleResults: readonly OracleResult[] = [
      applicability,
      ...evaluation.oracleResults
    ];

    const decision = decideOracleResults(
      oracleResults,
      DEFAULT_ORACLE_PROFILE
    );

    const verdict: VerificationVerdict = {
      verified: decision.converged,
      oracleResults,
      sastFindings: evaluation.semgrep.evidence.findings,
      semgrepDurationMs: evaluation.semgrep.durationMs,
      testReport: evaluation.functionalTest.evidence.report
    };

    assertVerificationVerdictInvariants(
      verdict,
      DEFAULT_ORACLE_PROFILE,
      true
    );

    return {
      verdict,
      decision
    };
  }

  private publishPhase(iteration: number, state: 'INSPECTION' | 'EVALUATION' | 'REFINEMENT'): void {
    this.ssePublisher?.({
      type: 'PHASE_TRANSITION',
      payload: {
        iteration,
        state
      }
    });
  }

  private publishOracleProgress(tool: | 'BUILD_SYNTAX' | 'SEMGREP' | 'TEST_HARNESS', completed: boolean, findingsCount: number): void {
    this.ssePublisher?.({
      type: 'ORACLE_PROGRESS',
      payload: {
        tool,
        completed,
        findingsCount
      }
    });
  }

  private validateApplicabilityRequirement(
    applicability: OracleResult<'APPLICABILITY'>,
    iteration: number
  ): ExecutionFailure | null {
    const expectedRequired =
      DEFAULT_ORACLE_PROFILE.requirements.APPLICABILITY ===
      'REQUIRED';

    if (applicability.required === expectedRequired) {
      return null;
    }

    return this.toFailure(
      'PATCH_VALIDATION',
      'ORACLE_INVARIANT_FAILURE',
      `Il risultato APPLICABILITY dichiara required=${applicability.required}, ` +
      `ma il profilo ${DEFAULT_ORACLE_PROFILE.id} richiede ` +
      `required=${expectedRequired}.`,
      false,
      iteration,
      'APPLICABILITY'
    );
  }

  private describeOracleInvariantViolation(decision: OracleDecision): string {
    const details: string[] = [];

    if (decision.missingRequiredOracles.length > 0) {
      details.push(
        `oracle obbligatori mancanti: ${decision.missingRequiredOracles.join(', ')
        }`
      );
    }

    if (decision.duplicateOracles.length > 0) {
      details.push(
        `risultati oracle duplicati: ${decision.duplicateOracles.join(', ')
        }`
      );
    }

    if (decision.requirementMismatches.length > 0) {
      details.push(
        `required incoerente con il profilo ${DEFAULT_ORACLE_PROFILE.id
        }: ${decision.requirementMismatches.join(', ')}`
      );
    }

    return details.length > 0
      ? `Violazione delle invarianti oracle: ${details.join('; ')}.`
      : 'Violazione non specificata delle invarianti oracle.';
  }

  private resolveTerminalResolution(params: {
    readonly failure?: ExecutionFailure;
    readonly decision?: OracleDecision;
    readonly refinementBudgetExhausted?: boolean;
    readonly requiredOracleUnavailable?: boolean;
  }): TerminalStateResolution {
    return resolveTerminalState({
      ...(params.failure !== undefined
        ? { failure: params.failure }
        : {}),
      ...(params.decision !== undefined
        ? { decision: params.decision }
        : {}),
      ...(params.refinementBudgetExhausted !== undefined
        ? {
          refinementBudgetExhausted:
            params.refinementBudgetExhausted
        }
        : {}),
      ...(params.requiredOracleUnavailable !== undefined
        ? {
          requiredOracleUnavailable:
            params.requiredOracleUnavailable
        }
        : {})
    });
  }

  private classifyTypedCoderFailure(error: unknown):
    | 'DIFF_EXTRACTION_FAILURE'
    | 'MODEL_GENERATION_FAILURE'
    | null {
    if (
      error instanceof CoderOutputExtractionError
    ) {
      return 'DIFF_EXTRACTION_FAILURE';
    }

    if (
      error instanceof CoderModelInvocationError
    ) {
      return 'MODEL_GENERATION_FAILURE';
    }

    return null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private toFailure(
    phase: ExecutionPhase,
    category: ExecutionErrorCategory,
    error: unknown,
    recoverable: boolean,
    iteration?: number,
    oracle?: OracleName
  ): ExecutionFailure {
    const base: ExecutionFailure = {
      phase,
      category,
      message: this.errorMessage(error),
      originalErrorName: error instanceof Error ? error.name : 'UnknownError',
      recoverable,
    };
    return {
      ...base,
      ...(iteration !== undefined ? { iteration } : {}),
      ...(oracle ? { oracle } : {})
    };
  }

  private async initializeTransaction(iteration: number): Promise<ExecutionFailure | null> {
    this.initialHead = undefined;
    this.rollbackResult = undefined;
    try {
      const initialHead = await this.gitManager.getHead();
      this.initialHead = initialHead;
      await this.gitManager.assertWorkingTreeClean();
      return null;
    } catch (error: unknown) {
      const failure = this.toFailure('INITIALIZATION', 'INFRASTRUCTURE_FAILURE', error, false, iteration);
      console.error('[RefinementFSM] Impossibile inizializzare la transazione Git:', failure);
      return failure;
    }
  }

  private async safeRollback(iteration?: number): Promise<ExecutionFailure | null> {
    const tRollback = this.telemetryTracker.startCpuMeasurement();
    try {
      if (!this.initialHead) {
        const failure = this.toFailure('ROLLBACK', 'ROLLBACK_FAILURE', 'Rollback impossibile: initial HEAD non registrato.', false, iteration);
        console.error('[RefinementFSM] Errore durante il rollback:', failure);
        return failure;
      }
      const rollbackResult = await this.gitManager.rollback(this.initialHead);
      this.rollbackResult = rollbackResult;
      if (rollbackResult.status === 'FAILED') {
        const failure = this.toFailure('ROLLBACK', 'ROLLBACK_FAILURE', rollbackResult.message ?? 'Il rollback Git non ha ripristinato completamente il repository.', false, iteration);
        console.error('[RefinementFSM] Rollback incompleto:', { failure, rollbackResult });
        return failure;
      }
      return null;
    } catch (error: unknown) {
      const failure = this.toFailure('ROLLBACK', 'ROLLBACK_FAILURE', error, false, iteration);
      console.error('[RefinementFSM] Errore imprevisto durante il rollback:', failure);
      return failure;
    } finally {
      this.telemetryTracker.recordOrchestrationCpu(tRollback);
    }
  }

  private createFailureState(
    params: InitialContextParams,
    failure: ExecutionFailure,
    iterations: readonly IterationRecord[],
    maxIterations?: number,
    finalPatch?: string
  ): WorkbenchSessionState {
    const terminalResolution =
      this.resolveTerminalResolution({
        failure,
        refinementBudgetExhausted: true
      });

    const candidateVerified = iterations.at(-1)?.verification.verified === true;
    const autonomousRunSucceeded = candidateVerified && terminalResolution.status === 'CONVERGED';

    return {
      taskId: this.taskId,
      issueSpec: params.issueSpec,
      category: params.category,
      status: terminalResolution.status,
      autonomousStatus: terminalResolution.status,
      candidateVerified,
      autonomousRunSucceeded,
      finalizationStatus: 'NOT_FINALIZED',
      targetFiles: params.targetFiles,
      testFiles: params.testFiles,
      currentIteration: iterations.length,
      maxIterations:
        maxIterations ??
        this.limits.maxIterations,
      iterations,
      ...(finalPatch
        ? { finalPatch }
        : {}),
      cumulativeTelemetry:
        this.telemetryTracker.getSnapshot(),
      ...(this.initialHead
        ? { initialHead: this.initialHead }
        : {}),
      ...(this.rollbackResult
        ? { rollbackResult: this.rollbackResult }
        : {}),
      failure,
      terminationReason:
        describeTerminalState(terminalResolution, failure)
    };
  }

  private publishFinalState(state: WorkbenchSessionState): WorkbenchSessionState {
    assertWorkbenchSessionInvariants(state, DEFAULT_ORACLE_PROFILE);
    this.ssePublisher?.({
      type: 'ITERATION_COMPLETE',
      payload: state
    });

    return state;
  }

  private createEmptyVerdict(
    testName = 'DryRunFailure',
    message =
      'Patch Application Failure: patch application failed.'
  ): VerificationVerdict {
    return {
      verified: false,
      oracleResults: [],
      sastFindings: [],
      testReport: {
        oracleStatus: 'NOT_AVAILABLE',
        command: null,
        args: [],
        cwd: null,
        timeoutMs: null,
        envAllowList: [],
        oracleFilesExecuted: [],
        implicitDiscoveryUsed: false,
        expectedExitPolicy: null,
        exitCode: null,
        suitePassed: false,
        timedOut: false,
        oracleFailed: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        xfailedTests: 0,
        xpassedTests: 0,
        errorTests: 0,
        passRate: 0,
        durationMs: 0,
        failureDetails: [
          {
            testName,
            assertionMessage: message,
            stackTrace:
              'La patch non ha superato il gate di applicabilità.'
          }
        ],
        stdout: '',
        stderr: '',
        rawStdout: '',
        rawStderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        executionDurationMs: 0
      }
    };
  }

  private getPatchChanges(patchDiff: string): {
    addedLines: number;
    deletedLines: number;
  } {
    let addedLines = 0;
    let deletedLines = 0;

    for (
      const line of patchDiff.split(/\r?\n/)
    ) {
      if (
        line.startsWith('+++') || line.startsWith('---')
      ) {
        continue;
      }

      if (line.startsWith('+')) {
        addedLines++;
      }

      if (line.startsWith('-')) {
        deletedLines++;
      }
    }

    return {
      addedLines,
      deletedLines
    };
  }
}
