import type { ExperimentCategory } from "./analytics.js";

export interface SastFinding {
  readonly ruleId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly message: string;
  readonly cweHierarchy?: readonly string[];
  readonly owaspCategory?: string | undefined;
}

export type OracleStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_AVAILABLE'
  | 'EXECUTION_ERROR';

export interface ApplicabilityOracleEvidence {
  readonly applyMode: 'GIT' | 'FUZZY' | 'NOT_APPLICABLE';
  readonly patchHash?: string;
  readonly reason?: string;
}

export interface BuildSyntaxOracleEvidence {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly envAllowList: readonly string[];
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly executionError?: string;
}

export interface SemgrepOracleEvidence {
  readonly findings: readonly SastFinding[];
  readonly scannedFiles: readonly string[];
  readonly executionError?: string;
}

export interface FunctionalTestOracleEvidence {
  readonly report: TestExecutionReport;
}

export interface OracleEvidenceMap {
  readonly APPLICABILITY: ApplicabilityOracleEvidence;
  readonly BUILD_SYNTAX: BuildSyntaxOracleEvidence;
  readonly SEMGREP: SemgrepOracleEvidence;
  readonly FUNCTIONAL_TEST: FunctionalTestOracleEvidence;
}

export type OracleName = keyof OracleEvidenceMap;

export type OracleRequirement =
  | 'REQUIRED'
  | 'OPTIONAL';

export interface OracleProfile {
  readonly id: string;
  readonly requirements: Readonly<Record<OracleName, OracleRequirement>>;
}

export type OracleEvidence = OracleEvidenceMap[OracleName];

type OracleResultMap = {
  readonly [TOracle in OracleName]: {
    readonly oracle: TOracle;
    readonly status: OracleStatus;
    readonly required: boolean;
    readonly durationMs: number;
    readonly summary: string;
    readonly evidence: OracleEvidenceMap[TOracle];
    readonly blockedBy?: OracleName;
    readonly blockedReason?: string;
  };
};

export type OracleResult<TOracle extends OracleName = OracleName> = OracleResultMap[TOracle];

export interface ExpectedExitPolicy {
  readonly passExitCodes: readonly number[];
  readonly failExitCodes: readonly number[];
  readonly executionErrorExitCodes: readonly number[];
}

export interface FunctionalTestOracleConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly oracleFiles: readonly string[];
  readonly envAllowList: readonly string[];
  readonly expectedExitPolicy: ExpectedExitPolicy;
  readonly allowImplicitDiscovery: boolean;
}


export interface TestExecutionReport {
  readonly oracleStatus: OracleStatus;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly timeoutMs: number | null;
  readonly envAllowList: readonly string[];
  readonly oracleFilesExecuted: readonly string[];
  readonly implicitDiscoveryUsed: boolean;
  readonly expectedExitPolicy: ExpectedExitPolicy | null;
  readonly exitCode: number | null;
  readonly suitePassed: boolean;
  readonly timedOut: boolean;
  readonly oracleFailed: boolean;
  readonly oracleFailureReason?: string;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
  readonly xfailedTests: number;
  readonly xpassedTests: number;
  readonly errorTests: number;
  readonly passRate: number;
  readonly durationMs: number;
  readonly failureDetails: ReadonlyArray<{
    readonly testName: string;
    readonly failureLocation?: { readonly file: string; readonly line: number };
    readonly assertionMessage: string;
    readonly stackTrace: string;
    readonly expected?: string;
    readonly actual?: string;
  }>;
  readonly stdout: string;
  readonly stderr: string;
  readonly rawStdout?: string;
  readonly rawStderr?: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly executionDurationMs: number;
}

export interface VerificationVerdict {
  readonly verified: boolean;
  readonly oracleResults: readonly OracleResult[];
  readonly sastFindings: readonly SastFinding[];
  readonly semgrepDurationMs?: number;
  readonly testReport: TestExecutionReport;
}

export type AgentRole = 'CODER' | 'REVIEWER';

export interface AgentUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly tokenUsageAvailable: boolean;
  readonly inferenceDurationMs: number;
}

export interface PatchChangeMetrics {
  readonly addedLines: number;
  readonly deletedLines: number;
}

export interface TargetRemediation {
  readonly file: string;
  readonly lineRange: { readonly start: number; readonly end: number };
  readonly rootCause: string;
  readonly mandatoryCorrection: string;
  readonly relatedRuleId?: string;
}

export interface CumulativeRemediation {
  readonly key: string;
  readonly remediation: TargetRemediation;
  readonly firstObservedIteration: number;
  readonly lastObservedIteration: number;
  readonly observationCount: number;
}

export type ReviewerMode =
  | 'LLM'
  | 'DETERMINISTIC_FALLBACK'
  | 'ORCHESTRATOR';

export interface ReviewerReviewResult {
  readonly feedback: ReviewerFeedbackPayload;
  readonly reviewerMode: ReviewerMode;
  readonly fallbackReason?: string;
}

export interface ReviewerFeedbackPayload {
  readonly rootCauseSummary: string;
  readonly violationsPrunedCount: number;
  readonly targetRemediations: readonly TargetRemediation[];
  readonly securityPriorityStrict: boolean;
  readonly flappingDetected: boolean;
}

export interface ComputationalTelemetry {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly tokenUsageAvailable: boolean;
  readonly inferenceDurationMs: number;
  readonly oracleDurationMs: number | null;
  readonly oracleDurationAvailable: boolean;
  readonly orchestrationOverheadMs: number;
  readonly totalDurationMs: number;
  readonly agentUsage: Readonly<Record<AgentRole, AgentUsage>>;
}

export interface IterationRecord {
  readonly iteration: number;
  readonly patchDiff: string;
  readonly patchHash: string;
  readonly isApplicable: boolean;
  readonly verification: VerificationVerdict;
  readonly reviewerFeedback?: ReviewerFeedbackPayload;
  readonly reviewerMode?: ReviewerMode;
  readonly fallbackReason?: string;
  readonly telemetry: ComputationalTelemetry;
  readonly agentUsage?: Readonly<Record<AgentRole, AgentUsage>>;
  readonly patchChanges?: PatchChangeMetrics;
  readonly applyMode: 'GIT' | 'FUZZY' | 'NOT_APPLICABLE';
  readonly fuzzyFallbackUsed?: boolean;
  readonly failure?: ExecutionFailure;
  readonly cumulativeRemediations?: readonly CumulativeRemediation[];
  readonly technicalAttempts?: number;
}

export type ExecutionPhase =
  | 'INITIALIZATION'
  | 'INSPECTION'
  | 'PATCH_VALIDATION'
  | 'PATCH_APPLICATION'
  | 'EVALUATION'
  | 'REVIEW'
  | 'REFINEMENT'
  | 'ROLLBACK'
  | 'PERSISTENCE'
  | 'FINALIZATION';

export type ExecutionErrorCategory =
  | 'CONTEXT_BUILD_FAILURE'
  | 'MODEL_GENERATION_FAILURE'
  | 'DIFF_EXTRACTION_FAILURE'
  | 'PATCH_SCOPE_FAILURE'
  | 'PATCH_NOT_APPLICABLE'
  | 'PATCH_APPLICATION_FAILURE'
  | 'ORACLE_EXECUTION_FAILURE'
  | 'ORACLE_INVARIANT_FAILURE'
  | 'REVIEWER_FAILURE'
  | 'REFINEMENT_CONTEXT_FAILURE'
  | 'REFINEMENT_STAGNATION'
  | 'ROLLBACK_FAILURE'
  | 'PERSISTENCE_FAILURE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'UNKNOWN_FAILURE';

export interface ExecutionFailure {
  readonly phase: ExecutionPhase;
  readonly category: ExecutionErrorCategory;
  readonly message: string;
  readonly originalErrorName?: string;
  readonly iteration?: number;
  readonly oracle?: OracleName;
  readonly recoverable: boolean;
}

export interface RollbackResult {
  readonly status: 'SUCCESS' | 'FAILED';
  readonly initialHead: string;
  readonly finalHead?: string;
  readonly repositoryClean: boolean;
  readonly workingTreeStatus: string;
  readonly message?: string;
}

export type ActiveWorkbenchSessionStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'INSPECTION'
  | 'EVALUATION'
  | 'REFINEMENT';

export type AutonomousWorkbenchSessionStatus =
  | 'CONVERGED'
  | 'UNRESOLVED'
  | 'FAILED'
  | 'INFRASTRUCTURE_ERROR';

export type FinalizationStatus =
  | 'NOT_FINALIZED'
  | 'APPROVED'
  | 'REJECTED';

export type TerminalWorkbenchSessionStatus =
  AutonomousWorkbenchSessionStatus;

export type WorkbenchSessionStatus =
  | ActiveWorkbenchSessionStatus
  | TerminalWorkbenchSessionStatus;

export interface WorkbenchSessionState {
  readonly taskId: string;
  readonly runId?: string | undefined;
  readonly issueSpec: string;
  readonly category: ExperimentCategory;
  readonly status: WorkbenchSessionStatus;
  readonly autonomousStatus?: AutonomousWorkbenchSessionStatus;
  readonly finalizationStatus: FinalizationStatus;
  readonly candidateVerified: boolean;
  readonly autonomousRunSucceeded: boolean;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly iterations: readonly IterationRecord[];
  readonly finalPatch?: string | undefined;
  readonly approvalCommitHash?: string | undefined;
  readonly cumulativeTelemetry: ComputationalTelemetry;
  readonly isHumanAugmented?: boolean;
  readonly failure?: ExecutionFailure;
  readonly terminationReason?: string;
  readonly initialHead?: string;
  readonly rollbackResult?: RollbackResult;
}

export type WorkbenchStreamEvent =
  | { readonly type: 'PHASE_TRANSITION'; readonly payload: { readonly iteration: number; readonly state: 'INSPECTION' | 'EVALUATION' | 'REFINEMENT' } }
  | { readonly type: 'ORACLE_PROGRESS'; readonly payload: { readonly tool: 'BUILD_SYNTAX' | 'SEMGREP' | 'TEST_HARNESS'; readonly completed: boolean; readonly findingsCount: number } }
  | { readonly type: 'TELEMETRY_UPDATE'; readonly payload: { readonly promptTokens: number | null; readonly completionTokens: number | null; readonly tokenUsageAvailable: boolean; readonly durationMs: number } }
  | { readonly type: 'ITERATION_COMPLETE'; readonly payload: WorkbenchSessionState };
