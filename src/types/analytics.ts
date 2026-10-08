import { WorkbenchSessionState } from './domain.js';

export type ExperimentMode = 'BASELINE' | 'MULTI_AGENT';
export type ExperimentCategory = 'REPAIR' | 'CREATE';

export interface ExperimentModelConfig {
  readonly baseUrl: string;
  readonly modelName: string;
  readonly seed: number;
  readonly temperature: number;
  readonly topP: number;
}

export interface ExperimentMetadata {
  readonly runId: string;
  readonly taskId: string;
  readonly category: ExperimentCategory;
  readonly mode: ExperimentMode;
  readonly apiBaseUrl: string;
  readonly modelName: string;
  readonly seed: number;
  readonly temperature: number;
  readonly topP: number;
  readonly timestamp: string;
  readonly status: WorkbenchSessionState['status'];
  readonly totalIterations: number;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly inferenceDurationMs: number;
  readonly oracleDurationMs: number;
  readonly frameworkDurationMs: number;
  readonly orchestrationOverheadMs: number;
  readonly endToEndOverheadPct: number | null;
  readonly activeFrameworkOverheadPct: number | null;
  readonly orchestrationOverheadBasis: 'NODE_PROCESS_CPU';
  readonly isHumanAugmented: boolean;
  readonly resolutionVerified: boolean;
}

export interface StoredRun {
  readonly schemaVersion: 1;
  readonly metadata: ExperimentMetadata;
  readonly modelConfig: ExperimentModelConfig;
  readonly session: WorkbenchSessionState;
  readonly targetSources: Readonly<Record<string, string>>;
}

export interface PatchGroundingCounts {
  readonly hunks: number;
  readonly ungroundedHunks: number;
  readonly oldSideLines: number;
  readonly ungroundedLines: number;
}

export interface RunQualityMetrics {
  readonly resolutionVerified: boolean;
  readonly testPassRatePct: number | null;
  readonly testCounts: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly xfailed: number;
    readonly errors: number;
  };
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
  readonly xfailedTests: number;
  readonly errorTests: number;
  readonly residualSastCount: number;
  readonly sastErrors: number;
  readonly sastWarnings: number;
  readonly allPatchesApplicable: boolean;
  readonly fuzzyFallbackUsed: boolean;
  readonly patchGrounding: PatchGroundingCounts;
  readonly hallucinationRatePct: number | null;
  readonly ungroundedHunkRatePct: number | null;
  readonly patchFlappingDetected: boolean;
  readonly addedLines: number;
  readonly deletedLines: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly coderPromptTokens: number;
  readonly coderCompletionTokens: number;
  readonly reviewerPromptTokens: number;
  readonly reviewerCompletionTokens: number;
  readonly totalTokens: number;
  readonly inferenceDurationMs: number;
  readonly oracleDurationMs: number;
  readonly endToEndOverheadPct: number | null;
  readonly activeFrameworkOverheadPct: number | null;
}

export interface RunSummary {
  readonly metadata: ExperimentMetadata;
  readonly metrics: RunQualityMetrics;
}

export interface ModeAggregateMetrics {
  readonly runCount: number;
  readonly resolvedCount: number;
  readonly successRatePct: number | null;
  readonly averageSuccessfulTokens: number | null;
  readonly averageInferenceDurationMs: number | null;
  readonly averageOracleDurationMs: number | null;
  readonly averageEndToEndOverheadPct: number | null;
  readonly averageActiveFrameworkOverheadPct: number | null;
  readonly averageResidualSastFindings: number | null;
  readonly averageAddedLines: number | null;
  readonly averageDeletedLines: number | null;
  readonly hallucinationRatePct: number | null;
  readonly ungroundedHunkRatePct: number | null;
  readonly convergenceDistribution: Readonly<Record<'1' | '2' | '3' | 'N_MAX', number>>;
}

export interface PairedTaskMetrics {
  readonly pairKey: string;
  readonly taskId: string;
  readonly category: ExperimentCategory;
  readonly modelName: string;
  readonly baseline: RunSummary;
  readonly multiAgent: RunSummary;
  readonly recoveredAfterRefinement: boolean;
}

export interface AggregatedMetricsReport {
  readonly generatedAt: string;
  readonly totalRuns: number;
  readonly modes: Readonly<Record<ExperimentMode, ModeAggregateMetrics>>;
  readonly autonomousRecoveryRatePct: number | null;
  readonly baselineFailuresInPairs: number;
  readonly averageTokenToFix: number | null;
  readonly averageOracleDurationMs: number | null;
  readonly averageCodeChurnLines: number | null;
  readonly pairedTasks: readonly PairedTaskMetrics[];
  readonly humanOverrideRatePct: number | null;
}

export interface RunHistoryFilters {
  readonly mode?: ExperimentMode;
  readonly category?: ExperimentCategory;
  readonly modelName?: string;
}
