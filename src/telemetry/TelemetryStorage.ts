import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { measurePatchGrounding } from '../git/UnifiedDiff.js';
import type {
  AggregatedMetricsReport,
  ExperimentCategory,
  ExperimentMetadata,
  ExperimentMode,
  ExperimentModelConfig,
  ExperimentProfileV3,
  ModeAggregateMetrics,
  PairedTaskMetrics,
  RunHistoryFilters,
  RunSummary,
  StoredRun,
  StoredRunV1,
  StoredRunV2,
  StoredRunV3,
  StoredRunV4
} from '../types/analytics.js';
import type { AgentUsage, AutonomousWorkbenchSessionStatus, ComputationalTelemetry, OracleStatus, TestExecutionReport, WorkbenchSessionState } from '../types/domain.js';
import { parsePytestSummary } from '../verification/PytestSummaryParser.js';
import {
  assertStoredRunV2PersistenceInvariants,
  assertStoredRunV3PersistenceInvariants,
  assertStoredRunV4PersistenceInvariants
} from './ArtifactPersistenceInvariants.js';

export class TelemetryStorage {
  constructor(private readonly storageDirectory = path.resolve(process.cwd(), 'experiments_log')) { }
  private static readonly LEGACY_INFERENCE_TIMEOUT_MS = 120_000;

  private normalizeTelemetry(
    telemetry: ComputationalTelemetry
  ): ComputationalTelemetry {
    const tokenValuesAvailable =
      typeof telemetry.promptTokens === 'number' &&
      typeof telemetry.completionTokens === 'number';

    const tokenUsageAvailable =
      typeof telemetry.tokenUsageAvailable === 'boolean'
        ? telemetry.tokenUsageAvailable &&
        tokenValuesAvailable
        : tokenValuesAvailable;

    const storedCoderUsage =
      telemetry.agentUsage?.CODER;

    const storedReviewerUsage =
      telemetry.agentUsage?.REVIEWER;

    const coderPromptTokens =
      storedCoderUsage
        ?.promptTokens ??
      null;

    const coderCompletionTokens =
      storedCoderUsage
        ?.completionTokens ??
      null;


    const coderValuesAvailable =
      typeof coderPromptTokens === 'number' &&
      typeof coderCompletionTokens === 'number';

    const coderTokenUsageAvailable =
      storedCoderUsage !== undefined &&
      (
        typeof storedCoderUsage
          .tokenUsageAvailable === 'boolean'
          ? storedCoderUsage
            .tokenUsageAvailable &&
          coderValuesAvailable
          : coderValuesAvailable
      );

    const coderUsage: AgentUsage = {
      promptTokens:
        coderTokenUsageAvailable
          ? coderPromptTokens
          : null,

      completionTokens:
        coderTokenUsageAvailable
          ? coderCompletionTokens
          : null,

      tokenUsageAvailable:
        coderTokenUsageAvailable,

      inferenceDurationMs:
        storedCoderUsage
          ?.inferenceDurationMs ??
        0
    };

    const reviewerPromptTokens =
      storedReviewerUsage
        ?.promptTokens ??
      null;

    const reviewerCompletionTokens =
      storedReviewerUsage
        ?.completionTokens ??
      null;

    const reviewerValuesAvailable =
      typeof reviewerPromptTokens ===
      'number' &&
      typeof reviewerCompletionTokens ===
      'number';

    const reviewerTokenUsageAvailable =
      storedReviewerUsage !== undefined &&
      (
        typeof storedReviewerUsage
          .tokenUsageAvailable === 'boolean'
          ? storedReviewerUsage
            .tokenUsageAvailable &&
          reviewerValuesAvailable
          : reviewerValuesAvailable
      );

    const reviewerUsage: AgentUsage = {
      promptTokens:
        reviewerTokenUsageAvailable
          ? reviewerPromptTokens
          : null,

      completionTokens:
        reviewerTokenUsageAvailable
          ? reviewerCompletionTokens
          : null,

      tokenUsageAvailable:
        reviewerTokenUsageAvailable,

      inferenceDurationMs:
        storedReviewerUsage
          ?.inferenceDurationMs ??
        0
    };

    const oracleDurationAvailable =
      telemetry.oracleDurationAvailable === true &&
      typeof telemetry.oracleDurationMs === 'number' &&
      Number.isFinite(
        telemetry.oracleDurationMs
      ) &&
      telemetry.oracleDurationMs >= 0;

    return {
      ...telemetry,

      promptTokens:
        tokenUsageAvailable
          ? telemetry.promptTokens
          : null,

      completionTokens:
        tokenUsageAvailable
          ? telemetry.completionTokens
          : null,

      tokenUsageAvailable,

      oracleDurationMs:
        oracleDurationAvailable
          ? telemetry.oracleDurationMs
          : null,

      oracleDurationAvailable,

      agentUsage: {
        CODER: coderUsage,
        REVIEWER: reviewerUsage
      }
    };
  }

  private totalTokens(promptTokens: number | null, completionTokens: number | null, tokenUsageAvailable: boolean): number | null {
    if (!tokenUsageAvailable || promptTokens === null || completionTokens === null) {
      return null;
    }

    return promptTokens + completionTokens;
  }

  private resolveAutonomousStatus(session: WorkbenchSessionState): NonNullable<WorkbenchSessionState['autonomousStatus']> {
    if (
      session.autonomousStatus !== undefined
    ) {
      return session.autonomousStatus;
    }

    if (
      session.status === 'CONVERGED' ||
      session.status === 'UNRESOLVED' ||
      session.status === 'FAILED' ||
      session.status === 'INFRASTRUCTURE_ERROR'
    ) {
      return session.status;
    }

    throw new Error(
      `La sessione ${session.taskId} non contiene ` +
      `un outcome autonomo persistibile.`
    );
  }

  public async saveRun(
    session: WorkbenchSessionState,
    mode: ExperimentMode,
    modelConfig: ExperimentModelConfig,
    category: ExperimentCategory,
    experimentProfile: ExperimentProfileV3,
    targetSources: Readonly<Record<string, string>> = {},
    testSources: Readonly<Record<string, string>> = {}
  ): Promise<string> {
    const runId =
      randomUUID();

    const timestamp =
      new Date().toISOString();

    const metadata =
      this.createMetadata(
        session,
        mode,
        modelConfig,
        category,
        runId,
        timestamp
      );

    const run: StoredRunV4 = {
      schemaVersion: 4,

      metadata,

      modelConfig,

      experimentProfile,

      session: {
        ...session,
        runId
      },

      targetSources,

      testSources
    };

    assertStoredRunV4PersistenceInvariants(
      run
    );

    await this.writeRun(
      run
    );

    return runId;
  }

  public async updateRun(
    runId: string,
    session: WorkbenchSessionState
  ): Promise<void> {
    const existing =
      await this.getRun(
        runId
      );

    if (!existing) {
      throw new Error(
        `Run analytics non trovato: ${runId}`
      );
    }

    if (
      existing.schemaVersion === 1
    ) {
      throw new Error(
        `Il run legacy ${runId} non può essere ` +
        `aggiornato senza un profilo sperimentale completo.`
      );
    }

    const metadata =
      this.createMetadata(
        session,
        existing.metadata.mode,
        existing.modelConfig,
        existing.metadata.category,
        runId,
        existing.metadata.timestamp
      );

    if (
      existing.schemaVersion === 2
    ) {
      const updated: StoredRunV2 = {
        ...existing,

        schemaVersion: 2,

        session: {
          ...session,
          runId
        },

        metadata
      };

      assertStoredRunV2PersistenceInvariants(
        updated
      );

      await this.writeRun(
        updated,
        runId
      );

      return;
    }

    if (existing.schemaVersion === 3) {
      const updated: StoredRunV3 = {
        ...existing,

        schemaVersion: 3,

        session: {
          ...session,
          runId
        },

        metadata
      };

      assertStoredRunV3PersistenceInvariants(
        updated
      );

      await this.writeRun(
        updated,
        runId
      );
      return;
    }

    const updated: StoredRunV4 = {
      ...existing,

      schemaVersion: 4,

      session: {
        ...session,
        runId
      },

      metadata
    };

    assertStoredRunV4PersistenceInvariants(
      updated
    );

    await this.writeRun(
      updated,
      runId
    );

  }

  public async getRun(runId: string): Promise<StoredRun | null> {
    if (!/^[a-f0-9-]{36}$/i.test(runId)) return null;
    const entries = await this.readRuns();
    const run = entries.find((entry) => entry.metadata.runId === runId);
    return run ? this.materializeRun(run) : null;
  }

  public async listRuns(filters: RunHistoryFilters = {}): Promise<RunSummary[]> {
    const runs = (await this.readRuns()).map((run) => this.materializeRun(run));
    return runs
      .filter((run) => !filters.mode || run.metadata.mode === filters.mode)
      .filter((run) => !filters.category || run.metadata.category === filters.category)
      .filter((run) => !filters.modelName || run.metadata.modelName === filters.modelName)
      .map((run) => this.toSummary(run))
      .sort((left, right) => right.metadata.timestamp.localeCompare(left.metadata.timestamp));
  }

  public async getAggregatedMetrics(filters: RunHistoryFilters = {}): Promise<AggregatedMetricsReport> {
    const runs = (await this.readRuns())
      .map((run) => this.materializeRun(run))
      .filter((run) => !filters.category || run.metadata.category === filters.category)
      .filter((run) => !filters.modelName || run.metadata.modelName === filters.modelName);
    const summaries = runs.map((run) => this.toSummary(run));
    const baseline = summaries.filter((run) => run.metadata.mode === 'BASELINE');
    const multiAgent = summaries.filter((run) => run.metadata.mode === 'MULTI_AGENT');
    const pairedTasks = this.buildPairs(baseline, multiAgent);
    const eligibleRecoveryPairs = pairedTasks.filter((pair) => pair.baseline.metadata.autonomousStatus === 'UNRESOLVED');
    const infrastructureExcludedPairs = pairedTasks.filter((pair) => pair.baseline.metadata.autonomousStatus === 'INFRASTRUCTURE_ERROR');
    const otherFailureExcludedPairs = pairedTasks.filter((pair) => pair.baseline.metadata.autonomousStatus === 'FAILED');
    const recovered = eligibleRecoveryPairs.filter((pair) => pair.recoveredAfterRefinement).length;
    const autonomousRecoveryEligiblePairs = eligibleRecoveryPairs.length;
    const autonomousRecoveryInfrastructureExcludedPairs = infrastructureExcludedPairs.length;
    const autonomousRecoveryOtherFailureExcludedPairs = otherFailureExcludedPairs.length;
    const baselineFailuresInPairs = autonomousRecoveryEligiblePairs;

    const approvedRuns = summaries.filter((run) => run.metadata.finalizationStatus === 'APPROVED');
    const verifiedRuns = summaries.filter((run) => run.metrics.candidateVerified);

    const comparableOracleDurationRuns =
      summaries.filter(
        (run) =>
          run.metrics.oracleDurationComparable &&
          run.metrics.oracleDurationMs !== null
      );

    const oracleDurationComparableRunCount =
      comparableOracleDurationRuns.length;

    const oracleDurationExcludedLegacyRunCount =
      summaries.filter(
        (run) =>
          !run.metrics.oracleDurationComparable
      ).length;
    return {
      generatedAt: new Date().toISOString(),
      totalRuns: summaries.length,
      modes: {
        BASELINE: this.aggregateMode(baseline),
        MULTI_AGENT: this.aggregateMode(multiAgent)
      },
      autonomousRecoveryRatePct: autonomousRecoveryEligiblePairs === 0 ? null : (recovered / autonomousRecoveryEligiblePairs) * 100,
      autonomousRecoveryEligiblePairs,
      autonomousRecoveryInfrastructureExcludedPairs,
      autonomousRecoveryOtherFailureExcludedPairs,
      baselineFailuresInPairs,
      averageTokensPerVerifiedRun: this.averageNullable(verifiedRuns.map((run) => run.metrics.totalTokens)),
      averageOracleDurationMs:
        this.averageNullable(
          comparableOracleDurationRuns.map(
            (run) =>
              run.metrics.oracleDurationMs
          )
        ),

      oracleDurationComparableRunCount,

      oracleDurationExcludedLegacyRunCount,
      averageProcessCodeChurnLines:
        this.average(
          summaries.map(
            (run) =>
              run.metrics.processAddedLines +
              run.metrics.processDeletedLines
          )
        ),

      averageFinalCodeChurnLines:
        this.average(
          summaries.map(
            (run) =>
              run.metrics.finalAddedLines +
              run.metrics.finalDeletedLines
          )
        ),
      pairedTasks,
      humanOverrideRatePct: approvedRuns.length === 0
        ? null
        : (approvedRuns.filter((run) => run.metadata.isHumanAugmented).length / approvedRuns.length) * 100
    };
  }

  public async compareTask(
    taskId: string,
    filters: Pick<RunHistoryFilters, 'category' | 'modelName'> & {
      readonly apiBaseUrl?: string;
      readonly seed?: number;
      readonly temperature?: number;
      readonly topP?: number;
      readonly inferenceTimeoutMs?: number;
    } = {}
  ): Promise<{ baseline: RunSummary | null; multiAgent: RunSummary | null }> {
    const runs = (await this.listRuns(filters)).filter((run) =>
      run.metadata.taskId === taskId &&
      (!filters.apiBaseUrl || run.metadata.apiBaseUrl === filters.apiBaseUrl) &&
      (filters.seed === undefined || run.metadata.seed === filters.seed) &&
      (filters.temperature === undefined || run.metadata.temperature === filters.temperature) &&
      (filters.topP === undefined || run.metadata.topP === filters.topP) &&
      (
        filters.inferenceTimeoutMs === undefined ||
        (
          run.comparability
            .inferenceTimeoutObserved &&
          run.metadata
            .inferenceTimeoutMs ===
          filters.inferenceTimeoutMs
        )
      )
    );
    const pairs = this.buildPairs(
      runs.filter((run) => run.metadata.mode === 'BASELINE'),
      runs.filter((run) => run.metadata.mode === 'MULTI_AGENT')
    );
    const latestPair = pairs.sort((left, right) =>
      right.multiAgent.metadata.timestamp.localeCompare(left.multiAgent.metadata.timestamp)
    )[0];
    return latestPair
      ? { baseline: latestPair.baseline, multiAgent: latestPair.multiAgent }
      : { baseline: null, multiAgent: null };
  }

  private async readRuns(): Promise<StoredRun[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.storageDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }

    const runs: StoredRun[] = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      const fullPath = path.join(this.storageDirectory, name);
      const text = await fs.readFile(fullPath, 'utf8');
      const parsed: unknown = JSON.parse(text);
      if (this.isStoredRun(parsed)) runs.push(parsed);
    }
    return runs;
  }

  private isStringRecord(
    value: unknown
  ): value is Readonly<Record<string, string>> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([file, content]) =>
          file.trim().length > 0 &&
          !/[\u0000-\u001F\u007F]/.test(file) &&
          typeof content === 'string'
      )
    );
  }

  private isStoredRun(
    value: unknown
  ): value is StoredRun {
    if (
      typeof value !== 'object' ||
      value === null
    ) {
      return false;
    }

    const candidate =
      value as Partial<StoredRun>;

    const schemaVersionValid =
      candidate.schemaVersion === 1 ||
      candidate.schemaVersion === 2 ||
      candidate.schemaVersion === 3 ||
      candidate.schemaVersion === 4;

    const profileRequired =
      candidate.schemaVersion === 2 ||
      candidate.schemaVersion === 3 ||
      candidate.schemaVersion === 4;

    const experimentProfileValid =
      !profileRequired ||
      (
        'experimentProfile' in candidate &&
        typeof candidate.experimentProfile === 'object' &&
        candidate.experimentProfile !== null
      );

    const issueSpecRequired =
      candidate.schemaVersion === 3 ||
      candidate.schemaVersion === 4;

    const issueSpecValid =
      !issueSpecRequired ||
      (
        'experimentProfile' in candidate &&
        typeof candidate.experimentProfile === 'object' &&
        candidate.experimentProfile !== null &&
        'fixture' in candidate.experimentProfile &&
        typeof candidate.experimentProfile.fixture === 'object' &&
        candidate.experimentProfile.fixture !== null &&
        'issueSpec' in candidate.experimentProfile.fixture &&
        typeof candidate.experimentProfile.fixture.issueSpec ===
        'string'
      );

    const v4TestSourcesValid =
      candidate.schemaVersion !== 4 ||
      (
        'testSources' in candidate &&
        this.isStringRecord(
          candidate.testSources
        )
      );

    const targetSourcesValid =
      'targetSources' in candidate &&
      this.isStringRecord(
        candidate.targetSources
      );

    return schemaVersionValid &&
      experimentProfileValid &&
      issueSpecValid &&
      targetSourcesValid &&
      v4TestSourcesValid &&
      typeof candidate.metadata?.runId === 'string' &&
      typeof candidate.metadata.taskId === 'string' &&
      (
        candidate.metadata.mode === 'BASELINE' ||
        candidate.metadata.mode === 'MULTI_AGENT'
      ) &&
      typeof candidate.session?.taskId === 'string' &&
      Array.isArray(
        candidate.session.iterations
      );
  }

  private materializeRun(
    run: StoredRun
  ): StoredRun {
    if (
      run.schemaVersion === 2 ||
      run.schemaVersion === 3 ||
      run.schemaVersion === 4
    ) {
      return run;
    }

    return this.normalizeLegacyV1(
      run
    );
  }

  private async writeRun(run: StoredRun, existingRunId?: string): Promise<void> {
    await fs.mkdir(this.storageDirectory, { recursive: true });
    const filename = existingRunId
      ? (await this.findFilename(existingRunId)) ?? this.filename(run)
      : this.filename(run);
    const destination = path.join(this.storageDirectory, filename);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, destination);
  }

  private async findFilename(runId: string): Promise<string | null> {
    const names = await fs.readdir(this.storageDirectory);
    return names.find((name) => name.endsWith('.json') && name.includes(runId)) ?? null;
  }

  private filename(run: StoredRun): string {
    const task = run.metadata.taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'task';
    const timestamp = run.metadata.timestamp.replace(/[:.]/g, '-');
    return `${task}_${run.metadata.mode}_${timestamp}_${run.metadata.runId}.json`;
  }

  private createMetadata(
    session: WorkbenchSessionState,
    mode: ExperimentMode,
    modelConfig: ExperimentModelConfig,
    category: ExperimentCategory,
    runId: string,
    timestamp: string
  ): ExperimentMetadata {

    const telemetry = session.cumulativeTelemetry;
    const autonomousStatus = this.resolveAutonomousStatus(session);
    return {
      runId,
      taskId: session.taskId,
      category,
      mode,
      apiBaseUrl: modelConfig.baseUrl,
      modelName: modelConfig.modelName,
      seed: modelConfig.seed,
      temperature: modelConfig.temperature,
      topP: modelConfig.topP,
      inferenceTimeoutMs: Number.isFinite(modelConfig.inferenceTimeoutMs)
        ? modelConfig.inferenceTimeoutMs
        : TelemetryStorage.LEGACY_INFERENCE_TIMEOUT_MS,
      timestamp,
      status: session.status,
      autonomousStatus,
      finalizationStatus: session.finalizationStatus,
      candidateVerified: session.candidateVerified,
      autonomousRunSucceeded: session.autonomousRunSucceeded,
      totalIterations: session.currentIteration,
      totalTokens: this.totalTokens(telemetry.promptTokens, telemetry.completionTokens, telemetry.tokenUsageAvailable),
      tokenUsageAvailable: telemetry.tokenUsageAvailable,
      totalDurationMs: telemetry.totalDurationMs,
      inferenceDurationMs: telemetry.inferenceDurationMs,
      oracleDurationMs: telemetry.oracleDurationMs,
      orchestrationOverheadMs: telemetry.orchestrationOverheadMs,
      orchestrationOverheadBasis: 'NODE_PROCESS_CPU',
      isHumanAugmented: session.isHumanAugmented ?? false,
      resolutionVerified: session.autonomousRunSucceeded
    };
  }

  private toSummary(run: StoredRun): RunSummary {
    const finalIteration = run.session.iterations.at(-1);
    const report = finalIteration?.verification.testReport;
    const processLines = run.session.iterations.reduce(
      (totals, iteration) => {
        const patchChanges = iteration.patchChanges ?? this.countPatchLines(iteration.patchDiff);
        return {
          added: totals.added + patchChanges.addedLines,
          deleted: totals.deleted + patchChanges.deletedLines
        };
      },
      {
        added: 0,
        deleted: 0
      }
    );
    const finalPatchChanges = finalIteration?.patchChanges ?? this.countPatchLines(finalIteration?.patchDiff ?? '');

    const findings = finalIteration?.verification.sastFindings ?? [];
    const processGrounding = run.session.iterations.reduce(
      (totals, iteration) => {
        const measured = iteration.patchDiff
          ? measurePatchGrounding(iteration.patchDiff, run.targetSources)
          : { hunks: 0, ungroundedHunks: 0, oldSideLines: 0, ungroundedLines: 0 };
        return {
          hunks: totals.hunks + measured.hunks,
          ungroundedHunks: totals.ungroundedHunks + measured.ungroundedHunks,
          oldSideLines: totals.oldSideLines + measured.oldSideLines,
          ungroundedLines: totals.ungroundedLines + measured.ungroundedLines
        };
      },
      { hunks: 0, ungroundedHunks: 0, oldSideLines: 0, ungroundedLines: 0 }
    );
    const finalPatchDiff = finalIteration?.patchDiff ?? '';
    const finalGrounding = finalPatchDiff.length > 0 ? measurePatchGrounding(finalPatchDiff, run.targetSources) :
      { hunks: 0, ungroundedHunks: 0, oldSideLines: 0, ungroundedLines: 0 };
    const totalTests = report?.totalTests ?? 0;
    const cumulativeTelemetry = run.session.cumulativeTelemetry;
    const agentUsage =
      cumulativeTelemetry.agentUsage ?? {
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
      };

    const metadata = run.metadata;
    const currentSchemaObserved =
      run.schemaVersion === 2 ||
      run.schemaVersion === 3 ||
      run.schemaVersion === 4;

    const inferenceTimeoutObserved =
      currentSchemaObserved;

    const agentUsageObserved =
      currentSchemaObserved;

    const oracleDurationComparable =
      currentSchemaObserved &&
      cumulativeTelemetry.oracleDurationAvailable === true &&
      cumulativeTelemetry.oracleDurationMs !== null;


    return {
      metadata,
      fixtureId:
        run.schemaVersion === 1
          ? null
          : run.experimentProfile
            .fixture
            .id,
      comparability: {
        inferenceTimeoutObserved,
        agentUsageObserved
      },
      metrics: {
        candidateVerified: metadata.candidateVerified,
        autonomousRunSucceeded: metadata.autonomousRunSucceeded,
        resolutionVerified: metadata.resolutionVerified,
        testPassRatePct: totalTests > 0 && report && (report.oracleStatus === 'PASS' || report.oracleStatus === 'FAIL')
          ? report.passRate * 100
          : null,
        testCounts: {
          total: totalTests,
          passed: report?.passedTests ?? 0,
          failed: report?.failedTests ?? 0,
          skipped: report?.skippedTests ?? 0,
          xfailed: report?.xfailedTests ?? 0,
          xpassed: report?.xpassedTests ?? 0,
          errors: report?.errorTests ?? 0
        },
        totalTests,
        passedTests: report?.passedTests ?? 0,
        failedTests: report?.failedTests ?? 0,
        skippedTests: report?.skippedTests ?? 0,
        xfailedTests: report?.xfailedTests ?? 0,
        xpassedTests: report?.xpassedTests ?? 0,
        errorTests: report?.errorTests ?? 0,
        residualSastCount: findings.length,
        sastErrors: findings.filter((finding) => finding.severity === 'ERROR').length,
        sastWarnings: findings.filter((finding) => finding.severity === 'WARNING').length,
        allPatchesApplicable: run.session.iterations.length > 0 && run.session.iterations.every((iteration) => iteration.isApplicable),
        fuzzyFallbackUsed: run.session.iterations.some((iteration) => iteration.fuzzyFallbackUsed ?? iteration.applyMode === 'FUZZY'),
        processPatchGrounding:
          processGrounding,

        processUngroundedOldSideLineRatePct:
          processGrounding.oldSideLines > 0
            ? (
              processGrounding.ungroundedLines /
              processGrounding.oldSideLines
            ) * 100
            : null,

        processUngroundedHunkRatePct:
          processGrounding.hunks > 0
            ? (
              processGrounding.ungroundedHunks /
              processGrounding.hunks
            ) * 100
            : null,

        finalPatchGrounding:
          finalGrounding,

        finalUngroundedOldSideLineRatePct:
          finalGrounding.oldSideLines > 0
            ? (
              finalGrounding.ungroundedLines /
              finalGrounding.oldSideLines
            ) * 100
            : null,

        finalUngroundedHunkRatePct:
          finalGrounding.hunks > 0
            ? (
              finalGrounding.ungroundedHunks /
              finalGrounding.hunks
            ) * 100
            : null,

        patchFlappingDetected:
          run.session.iterations.some(
            (iteration) =>
              iteration.reviewerFeedback
                ?.flappingDetected ??
              false
          ),

        processAddedLines:
          processLines.added,

        processDeletedLines:
          processLines.deleted,

        finalAddedLines:
          finalPatchChanges.addedLines,

        finalDeletedLines:
          finalPatchChanges.deletedLines,
        promptTokens: run.session.cumulativeTelemetry.promptTokens,
        completionTokens: run.session.cumulativeTelemetry.completionTokens,
        tokenUsageAvailable: run.session.cumulativeTelemetry.tokenUsageAvailable,

        coderPromptTokens:
          agentUsageObserved
            ? agentUsage.CODER.promptTokens
            : null,

        coderCompletionTokens:
          agentUsageObserved
            ? agentUsage.CODER
              .completionTokens
            : null,

        coderTokenUsageAvailable:
          agentUsageObserved &&
          agentUsage.CODER
            .tokenUsageAvailable,

        reviewerPromptTokens:
          agentUsageObserved
            ? agentUsage.REVIEWER
              .promptTokens
            : null,

        reviewerCompletionTokens:
          agentUsageObserved
            ? agentUsage.REVIEWER
              .completionTokens
            : null,

        reviewerTokenUsageAvailable:
          agentUsageObserved &&
          agentUsage.REVIEWER
            .tokenUsageAvailable,

        totalTokens: metadata.totalTokens,
        inferenceDurationMs: run.session.cumulativeTelemetry.inferenceDurationMs,
        oracleDurationMs:
          oracleDurationComparable
            ? cumulativeTelemetry.oracleDurationMs
            : null,

        oracleDurationComparable
      }
    };
  }

  private normalizeLegacyV1(run: StoredRunV1): StoredRunV1 {
    const iterations = run.session.iterations.map((iteration) => {
      const normalizedTelemetry = this.normalizeTelemetry(iteration.telemetry);
      const normalizedIterationAgentUsage = iteration.agentUsage ? this.normalizeTelemetry({
        ...iteration.telemetry,
        agentUsage: iteration.agentUsage
      }).agentUsage : normalizedTelemetry.agentUsage;
      const normalizedIteration = {
        ...iteration,
        telemetry: normalizedTelemetry,
        agentUsage: normalizedIterationAgentUsage
      };
      const report = iteration.verification.testReport as TestExecutionReport;
      const stdout = report.stdout ?? report.rawStdout ?? '';
      const stderr = report.stderr ?? report.rawStderr ?? '';
      const storedOracleStatus = (report as Partial<TestExecutionReport>).oracleStatus;
      if (storedOracleStatus === 'NOT_AVAILABLE') {
        const upgradedReport: TestExecutionReport = {
          ...report,
          oracleStatus: 'NOT_AVAILABLE',
          exitCode: report.exitCode ?? null,
          suitePassed: false,
          timedOut: report.timedOut ?? false,
          oracleFailed: false,
          totalTests: report.totalTests ?? 0,
          passedTests: report.passedTests ?? 0,
          failedTests: report.failedTests ?? 0,
          skippedTests: report.skippedTests ?? 0,
          xfailedTests: report.xfailedTests ?? 0,
          xpassedTests: report.xpassedTests ?? 0,
          errorTests: report.errorTests ?? 0,
          passRate: 0,
          durationMs: report.durationMs ?? report.executionDurationMs,
          stdout,
          stderr,
          rawStdout: report.rawStdout ?? stdout,
          rawStderr: report.rawStderr ?? stderr
        };
        return {
          ...normalizedIteration,
          verification: { ...iteration.verification, verified: false, testReport: upgradedReport }
        };
      }
      const parsedSummary = parsePytestSummary(`${stdout}\n${stderr}`);
      const oracleFailed = report.oracleFailed ?? false;
      if (!parsedSummary) {
        const upgradedReport: TestExecutionReport = {
          ...report,
          oracleStatus: 'EXECUTION_ERROR',
          exitCode: report.exitCode ?? null,
          suitePassed: false,
          timedOut: report.timedOut ?? false,
          oracleFailed: true,
          oracleFailureReason: report.oracleFailureReason ?? 'Report legacy privo di stdout Pytest verificabile.',
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          xfailedTests: 0,
          xpassedTests: 0,
          errorTests: 0,
          passRate: 0,
          durationMs: report.durationMs ?? report.executionDurationMs,
          stdout,
          stderr,
          rawStdout: report.rawStdout ?? stdout,
          rawStderr: report.rawStderr ?? stderr
        };
        return {
          ...normalizedIteration,
          verification: { ...iteration.verification, verified: false, testReport: upgradedReport }
        };
      }

      if (parsedSummary.zeroTestsCollected) {
        const upgradedReport: TestExecutionReport = {
          ...report,
          oracleStatus: 'EXECUTION_ERROR',
          exitCode: report.exitCode ?? null,
          suitePassed: false,
          timedOut: report.timedOut ?? false,
          oracleFailed: true,
          oracleFailureReason: report.oracleFailureReason ?? 'Il test runner aveva oracle dichiarati ma non ha raccolto alcun test.',
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          xfailedTests: 0,
          xpassedTests: 0,
          errorTests: 0,
          passRate: 0,
          durationMs: report.durationMs ?? report.executionDurationMs,
          stdout,
          stderr,
          rawStdout: report.rawStdout ?? stdout,
          rawStderr: report.rawStderr ?? stderr
        };

        return {
          ...normalizedIteration,
          verification: { ...iteration.verification, verified: false, testReport: upgradedReport }
        };
      }

      const exitCode = report.exitCode ?? null;
      const suitePassed = !oracleFailed &&
        exitCode === 0 &&
        parsedSummary.passedTests > 0 &&
        parsedSummary.failedTests === 0 &&
        parsedSummary.skippedTests === 0 &&
        parsedSummary.xfailedTests === 0 &&
        parsedSummary.xpassedTests === 0 &&
        parsedSummary.errorTests === 0 &&
        parsedSummary.passedTests === parsedSummary.totalTests;
      const oracleStatus: OracleStatus = oracleFailed ? 'EXECUTION_ERROR' : suitePassed ? 'PASS' : 'FAIL';
      const upgradedReport: TestExecutionReport = {
        ...report,
        oracleStatus,
        exitCode,
        suitePassed,
        timedOut: report.timedOut ?? false,
        oracleFailed,
        totalTests: parsedSummary.totalTests,
        passedTests: parsedSummary.passedTests,
        failedTests: parsedSummary.failedTests,
        skippedTests: parsedSummary.skippedTests,
        xfailedTests: parsedSummary.xfailedTests,
        xpassedTests: parsedSummary.xpassedTests,
        errorTests: parsedSummary.errorTests,
        passRate: parsedSummary.totalTests > 0 ? parsedSummary.passedTests / parsedSummary.totalTests : 0,
        durationMs: report.durationMs ?? report.executionDurationMs,
        stdout,
        stderr,
        rawStdout: report.rawStdout ?? stdout,
        rawStderr: report.rawStderr ?? stderr
      };
      return {
        ...normalizedIteration,
        verification: {
          ...iteration.verification,
          verified: iteration.verification.verified && suitePassed,
          testReport: upgradedReport
        }
      };
    });
    const finalIterationVerified = iterations.at(-1)?.verification.verified ?? false;
    const legacyStatus = run.session.status;
    let autonomousStatus: AutonomousWorkbenchSessionStatus;
    if (legacyStatus === 'CONVERGED') {
      autonomousStatus = finalIterationVerified ? 'CONVERGED' : 'FAILED';
    } else if (legacyStatus === 'UNRESOLVED' || legacyStatus === 'FAILED' || legacyStatus === 'INFRASTRUCTURE_ERROR') {
      autonomousStatus = legacyStatus;
    } else {
      throw new Error(`Il run legacy ${run.metadata.runId} contiene uno stato non terminale non materializzabile: ${legacyStatus}`);
    }

    const candidateVerified = finalIterationVerified;
    const autonomousRunSucceeded = autonomousStatus === 'CONVERGED' && candidateVerified;

    const upgradedSession:
      WorkbenchSessionState = {
      ...run.session,
      iterations,
      status: autonomousStatus,
      autonomousStatus,
      finalizationStatus:
        run.session.finalizationStatus ??
        'NOT_FINALIZED',
      candidateVerified,
      autonomousRunSucceeded
    };

    const normalizedCumulativeTelemetry =
      this.normalizeTelemetry(
        upgradedSession.cumulativeTelemetry
      );

    const cumulativeTelemetry:
      ComputationalTelemetry = {
      ...normalizedCumulativeTelemetry,

      oracleDurationMs:
        null,

      oracleDurationAvailable:
        false
    };

    const normalizedModelConfig: ExperimentModelConfig = {
      ...run.modelConfig,
      inferenceTimeoutMs: Number.isFinite(run.modelConfig.inferenceTimeoutMs)
        ? run.modelConfig.inferenceTimeoutMs
        : TelemetryStorage.LEGACY_INFERENCE_TIMEOUT_MS
    };
    const session: WorkbenchSessionState = { ...upgradedSession, cumulativeTelemetry };
    return {
      ...run,
      schemaVersion: 1,
      modelConfig: normalizedModelConfig,
      session,
      metadata: this.createMetadata(
        session,
        run.metadata.mode,
        normalizedModelConfig,
        run.metadata.category,
        run.metadata.runId,
        run.metadata.timestamp
      )
    };
  }

  private countPatchLines(diff: string): { addedLines: number; deletedLines: number } {
    let addedLines = 0;
    let deletedLines = 0;
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith('+++') || line.startsWith('---')) continue;
      if (line.startsWith('+')) addedLines += 1;
      if (line.startsWith('-')) deletedLines += 1;
    }
    return { addedLines, deletedLines };
  }

  private aggregateMode(
    runs: readonly RunSummary[]
  ): ModeAggregateMetrics {
    const pooledRate = (
      numerator: number,
      denominator: number
    ): number | null =>
      denominator > 0
        ? (numerator / denominator) * 100
        : null;

    const resolvedRuns =
      runs.filter(
        (run) =>
          run.metrics.autonomousRunSucceeded
      );

    const rawConvergenceNumerator =
      resolvedRuns.length;

    const rawConvergenceDenominator =
      runs.length;

    const rawConvergenceRatePct =
      pooledRate(
        rawConvergenceNumerator,
        rawConvergenceDenominator
      );

    const validRuns =
      runs.filter(
        (run) =>
          run.metadata.autonomousStatus ===
          'CONVERGED' ||
          run.metadata.autonomousStatus ===
          'UNRESOLVED'
      );

    const validConvergedRuns =
      validRuns.filter(
        (run) =>
          run.metrics.autonomousRunSucceeded
      );

    const validRunConvergenceNumerator =
      validConvergedRuns.length;

    const validRunConvergenceDenominator =
      validRuns.length;

    const validRunConvergenceRatePct =
      pooledRate(
        validRunConvergenceNumerator,
        validRunConvergenceDenominator
      );

    const invalidRunCount =
      runs.length -
      validRuns.length;

    const distribution = {
      '1': 0,
      '2': 0,
      '3': 0,
      N_MAX: 0
    };

    let convergenceDistributionInvalidRunCount = 0;

    for (const run of runs) {
      const iterations =
        run.metadata.totalIterations;

      if (
        run.metadata.autonomousStatus ===
        'FAILED' ||
        run.metadata.autonomousStatus ===
        'INFRASTRUCTURE_ERROR'
      ) {
        convergenceDistributionInvalidRunCount += 1;
        continue;
      }

      if (
        run.metadata.autonomousStatus ===
        'UNRESOLVED'
      ) {
        distribution.N_MAX += 1;
        continue;
      }

      if (
        !run.metrics.autonomousRunSucceeded
      ) {
        convergenceDistributionInvalidRunCount += 1;
        continue;
      }

      if (iterations <= 1) {
        distribution['1'] += 1;
      } else if (iterations === 2) {
        distribution['2'] += 1;
      } else {
        distribution['3'] += 1;
      }
    }

    const comparableOracleDurationRuns =
      runs.filter(
        (run) =>
          run.metrics.oracleDurationComparable &&
          run.metrics.oracleDurationMs !== null
      );

    const oracleDurationComparableRunCount =
      comparableOracleDurationRuns.length;

    const oracleDurationExcludedLegacyRunCount =
      runs.filter(
        (run) =>
          !run.metrics.oracleDurationComparable
      ).length;

    return {
      runCount:
        runs.length,

      resolvedCount:
        resolvedRuns.length,

      rawConvergenceNumerator,

      rawConvergenceDenominator,

      rawConvergenceRatePct,

      validRunConvergenceNumerator,

      validRunConvergenceDenominator,

      validRunConvergenceRatePct,

      invalidRunCount,

      successRatePct:
        rawConvergenceRatePct,

      averageSuccessfulTokens:
        this.averageNullable(
          resolvedRuns.map(
            (run) =>
              run.metrics.totalTokens
          )
        ),

      averageInferenceDurationMs:
        this.average(
          runs.map(
            (run) =>
              run.metrics.inferenceDurationMs
          )
        ),

      averageOracleDurationMs:
        this.averageNullable(
          comparableOracleDurationRuns.map(
            (run) =>
              run.metrics.oracleDurationMs
          )
        ),

      oracleDurationComparableRunCount,

      oracleDurationExcludedLegacyRunCount,

      averageResidualSastFindings:
        this.average(
          runs.map(
            (run) =>
              run.metrics.residualSastCount
          )
        ),

      averageProcessAddedLines:
        this.average(
          runs.map(
            (run) =>
              run.metrics.processAddedLines
          )
        ),

      averageProcessDeletedLines:
        this.average(
          runs.map(
            (run) =>
              run.metrics.processDeletedLines
          )
        ),

      processUngroundedOldSideLineRatePct:
        pooledRate(
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .processPatchGrounding
                .ungroundedLines,
            0
          ),
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .processPatchGrounding
                .oldSideLines,
            0
          )
        ),
      processUngroundedHunkRatePct:
        pooledRate(
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .processPatchGrounding
                .ungroundedHunks,
            0
          ),
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .processPatchGrounding
                .hunks,
            0
          )
        ),

      finalUngroundedOldSideLineRatePct:
        pooledRate(
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .finalPatchGrounding
                .ungroundedLines,
            0
          ),
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .finalPatchGrounding
                .oldSideLines,
            0
          )
        ),

      finalUngroundedHunkRatePct:
        pooledRate(
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .finalPatchGrounding
                .ungroundedHunks,
            0
          ),
          runs.reduce(
            (sum, run) =>
              sum +
              run.metrics
                .finalPatchGrounding
                .hunks,
            0
          )
        ),

      convergenceDistribution:
        distribution,
      convergenceDistributionInvalidRunCount
    };
  }

  private buildPairs(baselineRuns: readonly RunSummary[], multiRuns: readonly RunSummary[]): PairedTaskMetrics[] {
    const latestBaseline =
      this.latestByKey(
        baselineRuns.filter(
          (run) =>
            run.comparability
              .inferenceTimeoutObserved
        )
      );

    const latestMulti =
      this.latestByKey(
        multiRuns.filter(
          (run) =>
            run.comparability
              .inferenceTimeoutObserved
        )
      );
    const pairs: PairedTaskMetrics[] = [];
    for (const [key, baseline] of latestBaseline) {
      const multiAgent = latestMulti.get(key);
      if (!multiAgent) continue;
      const recoveredAfterRefinement = !baseline.metrics.autonomousRunSucceeded &&
        multiAgent.metrics.autonomousRunSucceeded && multiAgent.metadata.totalIterations > 1;
      const pairKey = [
        baseline.fixtureId ?? baseline.metadata.taskId,
        baseline.metadata.category,
        baseline.metadata.modelName,
        baseline.metadata.apiBaseUrl,
        baseline.metadata.seed,
        baseline.metadata.temperature,
        baseline.metadata.topP,
        baseline.metadata.inferenceTimeoutMs
      ].join('|');
      pairs.push({
        pairKey,
        taskId: baseline.metadata.taskId,
        category: baseline.metadata.category,
        modelName: baseline.metadata.modelName,
        baseline,
        multiAgent,
        recoveredAfterRefinement
      });
    }
    return pairs.sort((left, right) => left.taskId.localeCompare(right.taskId));
  }

  private latestByKey(runs: readonly RunSummary[]): Map<string, RunSummary> {
    const latest = new Map<string, RunSummary>();
    for (const run of runs) {
      const key = [
        run.fixtureId ?? run.metadata.taskId,
        run.metadata.category,
        run.metadata.modelName,
        run.metadata.apiBaseUrl,
        run.metadata.seed,
        run.metadata.temperature,
        run.metadata.topP,
        run.metadata.inferenceTimeoutMs
      ].join('\0');
      const current = latest.get(key);
      if (!current || current.metadata.timestamp < run.metadata.timestamp) latest.set(key, run);
    }
    return latest;
  }

  private average(values: readonly number[]): number | null {
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
  }

  private averageNullable(values: readonly (number | null)[]): number | null {
    const availableValues = values.filter((value): value is number => value !== null);
    return this.average(availableValues);
  }

}
