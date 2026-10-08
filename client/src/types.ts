export interface SastFinding {
  readonly ruleId: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
  readonly message: string;
  readonly cweHierarchy?: readonly string[] | undefined;
  readonly owaspCategory?: string | undefined;
}

export interface TestFailureDetail {
  readonly testName: string;
  readonly failureLocation?: { readonly file: string; readonly line: number } | undefined;
  readonly assertionMessage: string;
  readonly stackTrace: string;
  readonly expected?: string | undefined;
  readonly actual?: string | undefined;
}

export interface TestExecutionReport {
  readonly exitCode: number | null;
  readonly suitePassed: boolean;
  readonly timedOut: boolean;
  readonly oracleFailed: boolean;
  readonly oracleFailureReason?: string | undefined;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
  readonly xfailedTests: number;
  readonly errorTests: number;
  readonly passRate: number;
  readonly durationMs: number;
  readonly failureDetails: readonly TestFailureDetail[];
  readonly stdout: string;
  readonly stderr: string;
  readonly rawStdout?: string | undefined;
  readonly rawStderr?: string | undefined;
  readonly executionDurationMs: number;
}

export interface ComputationalTelemetry {
  promptTokens: number;
  completionTokens: number;
  inferenceDurationMs: number;
  oracleDurationMs: number;
  orchestrationOverheadMs: number;
  totalDurationMs: number;
}

export interface ReviewerRemediation {
  readonly file: string;
  readonly lineRange: { readonly start: number; readonly end: number };
  readonly rootCause: string;
  readonly mandatoryCorrection: string;
  readonly relatedRuleId?: string | undefined;
}

export interface ReviewerFeedbackPayload {
  readonly rootCauseSummary: string;
  readonly violationsPrunedCount: number;
  readonly targetRemediations: readonly ReviewerRemediation[];
  readonly securityPriorityStrict: boolean;
  readonly flappingDetected: boolean;
}

export interface IterationRecord {
  readonly iteration: number;
  readonly patchDiff: string;
  readonly patchHash: string;
  readonly isApplicable: boolean;
  readonly verification: {
    readonly verified: boolean;
    readonly sastFindings: readonly SastFinding[];
    readonly testReport: TestExecutionReport;
  };
  readonly reviewerFeedback?: ReviewerFeedbackPayload | undefined;
  readonly telemetry: ComputationalTelemetry;
}

export interface WorkbenchSessionState {
  readonly taskId: string;
  readonly runId?: string | undefined;
  readonly issueSpec: string;
  readonly status: 'RUNNING' | 'PENDING' | 'INSPECTION' | 'EVALUATION' | 'REFINEMENT' | 'CONVERGED' | 'UNRESOLVED' | 'FAILED' | 'APPROVED' | 'REJECTED';
  readonly targetFiles: readonly string[];
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly iterations: readonly IterationRecord[];
  readonly finalPatch?: string | undefined;
  readonly approvalCommitHash?: string | undefined;
  readonly cumulativeTelemetry: ComputationalTelemetry;
  readonly isHumanAugmented?: boolean | undefined;
}

export type WorkbenchStreamEvent =
  | { readonly type: 'PHASE_TRANSITION'; readonly payload: { readonly iteration: number; readonly state: 'INSPECTION' | 'EVALUATION' | 'REFINEMENT' } }
  | { readonly type: 'ORACLE_PROGRESS'; readonly payload: { readonly tool: 'SEMGREP' | 'TEST_HARNESS'; readonly completed: boolean; readonly findingsCount: number } }
  | { readonly type: 'TELEMETRY_UPDATE'; readonly payload: { readonly promptTokens: number; readonly completionTokens: number; readonly durationMs: number } }
  | { readonly type: 'ITERATION_COMPLETE'; readonly payload: WorkbenchSessionState };
