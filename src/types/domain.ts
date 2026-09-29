/**
 * Rappresentazione formale di una violazione statica Semgrep filtrata su diff (RF-04).
 */
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

/**
 * Report dettagliato di esecuzione della suite di test unitari (RF-05).
 */
export interface TestExecutionReport {
  readonly suitePassed: boolean;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly failureDetails: ReadonlyArray<{
    readonly testName: string;
    readonly failureLocation?: { readonly file: string; readonly line: number };
    readonly assertionMessage: string;
    readonly stackTrace: string;
    readonly expected?: string;
    readonly actual?: string;
  }>;
  readonly rawStderr: string;
  readonly executionDurationMs: number;
}

/**
 * Riscontro sintetico dell'oracolo deterministico a due stadi.
 */
export interface VerificationVerdict {
  readonly verified: boolean;
  readonly sastFindings: readonly SastFinding[];
  readonly testReport: TestExecutionReport;
}

/**
 * Payload diagnostico strutturato prodotto dall'Agente Reviewer (RF-06).
 */
export interface ReviewerFeedbackPayload {
  readonly rootCauseSummary: string;
  readonly violationsPrunedCount: number;
  readonly targetRemediations: ReadonlyArray<{
    readonly file: string;
    readonly lineRange: { readonly start: number; readonly end: number };
    readonly rootCause: string;
    readonly mandatoryCorrection: string;
    readonly relatedRuleId?: string;
  }>;
  readonly securityPriorityStrict: boolean;
  readonly flappingDetected: boolean;
}

/**
 * Metriche di telemetria e overhead (RNF-02, RNF-05).
 */
export interface ComputationalTelemetry {
  promptTokens: number;
  completionTokens: number;
  inferenceDurationMs: number;
  orchestrationOverheadMs: number;
  totalDurationMs: number;
}

/**
 * Snapshot dell'iterazione del ciclo correttivo.
 */
export interface IterationRecord {
  readonly iteration: number;
  readonly patchDiff: string;
  readonly patchHash: string;
  readonly isApplicable: boolean;
  readonly verification: VerificationVerdict;
  readonly reviewerFeedback?: ReviewerFeedbackPayload;
  readonly telemetry: ComputationalTelemetry;
}

/**
 * Stato complessivo della sessione esposto al Workbench (RF-08).
 */
export interface WorkbenchSessionState {
  readonly taskId: string;
  readonly issueSpec: string;
  readonly status: 'RUNNING' | 'CONVERGED' | 'UNRESOLVED' | 'FAILED' | 'RUNNING';
  readonly targetFiles: readonly string[];
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly iterations: readonly IterationRecord[];
  readonly finalPatch?: string | undefined;
  readonly cumulativeTelemetry: ComputationalTelemetry;
  readonly humanOverrideApplied?: boolean;
}

/**
 * Canale di streaming reattivo basato su Server-Sent Events.
 */
export type WorkbenchStreamEvent =
  | { readonly type: 'PHASE_TRANSITION'; readonly payload: { readonly iteration: number; readonly state: 'INSPECTION' | 'EVALUATION' | 'REFINEMENT' } }
  | { readonly type: 'ORACLE_PROGRESS'; readonly payload: { readonly tool: 'SEMGREP' | 'TEST_HARNESS'; readonly completed: boolean; readonly findingsCount: number } }
  | { readonly type: 'TELEMETRY_UPDATE'; readonly payload: { readonly promptTokens: number; readonly completionTokens: number; readonly durationMs: number } }
  | { readonly type: 'ITERATION_COMPLETE'; readonly payload: WorkbenchSessionState };
