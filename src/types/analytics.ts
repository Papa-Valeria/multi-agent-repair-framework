import type {
  FunctionalTestOracleConfig,
  WorkbenchSessionState
} from './domain.js';

import type {
  BuildOracleConfig
} from '../inference/BuildOracleConfig.js';

export type ExperimentMode = 'BASELINE' | 'MULTI_AGENT';
export type ExperimentCategory = 'REPAIR' | 'CREATE';

export interface ExperimentModelConfig {
  readonly baseUrl: string;
  readonly modelName: string;
  readonly seed: number;
  readonly temperature: number;
  readonly topP: number;
  readonly inferenceTimeoutMs: number;
}

export interface ExperimentSemgrepConfig {
  readonly command: string;
  readonly timeoutMs: number;
  readonly envAllowList: readonly string[];
}

export interface ExperimentLimits {
  readonly maxIterations: number;
  readonly maxTechnicalAttempts: number;
}

export interface ExperimentFixtureIdentity {
  readonly id: string;
  readonly taskId: string;
  readonly category: ExperimentCategory;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
}

export interface ExperimentFixtureIdentityV3
  extends ExperimentFixtureIdentity {
  readonly issueSpec: string;
}

export interface ExperimentProfile {
  readonly oracleProfileId: string;
  readonly promptProfileId: string;
  readonly semgrepProfileId: string;
  readonly buildOracleConfig: BuildOracleConfig;
  readonly functionalTestOracleConfig: FunctionalTestOracleConfig;
  readonly semgrepConfig: ExperimentSemgrepConfig;
  readonly modelConfig: ExperimentModelConfig;
  readonly limits: ExperimentLimits;
  readonly fixture: ExperimentFixtureIdentity;
}

export interface ExperimentProfileV3
  extends Omit<
    ExperimentProfile,
    'fixture'
  > {
  readonly fixture:
  ExperimentFixtureIdentityV3;
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
  readonly inferenceTimeoutMs: number;
  readonly timestamp: string;
  readonly status: WorkbenchSessionState['status'];
  readonly autonomousStatus: NonNullable<WorkbenchSessionState['autonomousStatus']>;
  readonly finalizationStatus: WorkbenchSessionState['finalizationStatus'];
  readonly candidateVerified: boolean;
  readonly autonomousRunSucceeded: boolean;
  readonly totalIterations: number;
  readonly totalTokens: number | null;
  readonly tokenUsageAvailable: boolean;
  readonly totalDurationMs: number;
  readonly inferenceDurationMs: number;
  readonly oracleDurationMs: number | null;
  readonly orchestrationOverheadMs: number;
  readonly orchestrationOverheadBasis: 'NODE_PROCESS_CPU';
  readonly isHumanAugmented: boolean;
  readonly resolutionVerified: boolean;
}

interface StoredRunArtifact {
  readonly metadata: ExperimentMetadata;
  readonly modelConfig: ExperimentModelConfig;
  readonly session: WorkbenchSessionState;
  readonly targetSources: Readonly<Record<string, string>>;
}

export interface StoredRunV1 extends StoredRunArtifact {
  readonly schemaVersion: 1;
}

export interface StoredRunV2 extends StoredRunArtifact {
  readonly schemaVersion: 2;
  readonly experimentProfile: ExperimentProfile;
}

export interface StoredRunV3
  extends StoredRunArtifact {
  readonly schemaVersion: 3;
  readonly experimentProfile: ExperimentProfileV3;
}

export interface StoredRunV4
  extends StoredRunArtifact {
  readonly schemaVersion: 4;
  readonly experimentProfile: ExperimentProfileV3;
  readonly testSources: Readonly<Record<string, string>>;
}

export type StoredRun =
  | StoredRunV1
  | StoredRunV2
  | StoredRunV3
  | StoredRunV4;

export interface PatchGroundingCounts {
  readonly hunks: number;
  readonly ungroundedHunks: number;
  readonly oldSideLines: number;
  readonly ungroundedLines: number;
}

export interface RunQualityMetrics {
  readonly candidateVerified: boolean;
  readonly autonomousRunSucceeded: boolean;
  readonly resolutionVerified: boolean;
  readonly testPassRatePct: number | null;
  readonly testCounts: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly xfailed: number;
    readonly xpassed: number;
    readonly errors: number;
  };
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly skippedTests: number;
  readonly xfailedTests: number;
  readonly xpassedTests: number;
  readonly errorTests: number;
  readonly residualSastCount: number;
  readonly sastErrors: number;
  readonly sastWarnings: number;
  readonly allPatchesApplicable: boolean;
  readonly fuzzyFallbackUsed: boolean;
  readonly processPatchGrounding: PatchGroundingCounts;
  readonly processUngroundedOldSideLineRatePct: number | null;
  readonly processUngroundedHunkRatePct: number | null;
  readonly finalPatchGrounding: PatchGroundingCounts;
  readonly finalUngroundedOldSideLineRatePct: number | null;
  readonly finalUngroundedHunkRatePct: number | null;
  readonly patchFlappingDetected: boolean;
  readonly processAddedLines: number;
  readonly processDeletedLines: number;
  readonly finalAddedLines: number;
  readonly finalDeletedLines: number;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly tokenUsageAvailable: boolean;
  readonly coderPromptTokens: number | null;
  readonly coderCompletionTokens: number | null;
  readonly coderTokenUsageAvailable: boolean;
  readonly reviewerPromptTokens: number | null;
  readonly reviewerCompletionTokens: number | null;
  readonly reviewerTokenUsageAvailable: boolean;
  readonly totalTokens: number | null;
  readonly inferenceDurationMs: number;
  readonly oracleDurationMs: number | null;
  readonly oracleDurationComparable: boolean;
}

export interface RunComparability {
  readonly inferenceTimeoutObserved: boolean;
  readonly agentUsageObserved: boolean;
}

export interface RunSummary {
  readonly metadata: ExperimentMetadata;
  readonly fixtureId: string | null;
  readonly comparability: RunComparability;
  readonly metrics: RunQualityMetrics;
}

export interface ModeAggregateMetrics {
  readonly runCount: number;
  readonly resolvedCount: number;
  readonly rawConvergenceNumerator: number;
  readonly rawConvergenceDenominator: number;
  readonly rawConvergenceRatePct: number | null;
  readonly validRunConvergenceNumerator: number;
  readonly validRunConvergenceDenominator: number;
  readonly validRunConvergenceRatePct: number | null;
  readonly invalidRunCount: number;
  readonly successRatePct: number | null;
  readonly averageSuccessfulTokens: number | null;
  readonly averageInferenceDurationMs: number | null;
  readonly averageOracleDurationMs: number | null;
  readonly oracleDurationComparableRunCount: number;
  readonly oracleDurationExcludedLegacyRunCount: number;
  readonly averageResidualSastFindings: number | null;
  readonly averageProcessAddedLines: number | null;
  readonly averageProcessDeletedLines: number | null;
  readonly processUngroundedOldSideLineRatePct: number | null;
  readonly processUngroundedHunkRatePct: number | null;
  readonly finalUngroundedOldSideLineRatePct: number | null;
  readonly finalUngroundedHunkRatePct: number | null;
  readonly convergenceDistribution: Readonly<Record<'1' | '2' | '3' | 'N_MAX', number>>;
  readonly convergenceDistributionInvalidRunCount: number;
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
  readonly autonomousRecoveryEligiblePairs: number;
  readonly autonomousRecoveryInfrastructureExcludedPairs: number;
  readonly autonomousRecoveryOtherFailureExcludedPairs: number;
  readonly baselineFailuresInPairs: number;
  readonly averageTokensPerVerifiedRun: number | null;
  readonly averageOracleDurationMs: number | null;
  readonly oracleDurationComparableRunCount: number;
  readonly oracleDurationExcludedLegacyRunCount: number;
  readonly averageProcessCodeChurnLines: number | null;
  readonly averageFinalCodeChurnLines: number | null;
  readonly pairedTasks: readonly PairedTaskMetrics[];
  readonly humanOverrideRatePct: number | null;
}

export interface RunHistoryFilters {
  readonly mode?: ExperimentMode;
  readonly category?: ExperimentCategory;
  readonly modelName?: string;
}
