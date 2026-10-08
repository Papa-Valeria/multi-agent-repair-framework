import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WorkbenchSessionState } from '../types/domain.js';
import { TestExecutionReport } from '../types/domain.js';
import {
  getActiveFrameworkOverheadPct,
  getEndToEndOverheadPct,
  getFrameworkDurationMs
} from './AnalyticsMetrics.js';
import {
  AggregatedMetricsReport,
  ExperimentCategory,
  ExperimentMetadata,
  ExperimentMode,
  ExperimentModelConfig,
  ModeAggregateMetrics,
  PairedTaskMetrics,
  RunHistoryFilters,
  RunSummary,
  StoredRun
} from '../types/analytics.js';
import { parsePytestSummary } from '../verification/PytestSummaryParser.js';
import { measurePatchGrounding } from '../git/UnifiedDiff.js';

export class TelemetryStorage {
  constructor(private readonly storageDirectory = path.resolve(process.cwd(), 'experiments_log')) {}

  public async saveRun(
    session: WorkbenchSessionState,
    mode: ExperimentMode,
    modelConfig: ExperimentModelConfig,
    category: ExperimentCategory = 'REPAIR',
    targetSources: Readonly<Record<string, string>> = {}
  ): Promise<string> {
    const runId = randomUUID();
    const timestamp = new Date().toISOString();
    const metadata = this.createMetadata(session, mode, modelConfig, category, runId, timestamp);
    const run: StoredRun = { schemaVersion: 1, metadata, modelConfig, session: { ...session, runId }, targetSources };
    await this.writeRun(run);
    return runId;
  }

  public async updateRun(runId: string, session: WorkbenchSessionState): Promise<void> {
    const existing = await this.getRun(runId);
    if (!existing) throw new Error(`Run analytics non trovato: ${runId}`);
    const updated: StoredRun = {
      ...existing,
      session: { ...session, runId },
      metadata: this.createMetadata(
        session,
        existing.metadata.mode,
        existing.modelConfig,
        existing.metadata.category,
        runId,
        existing.metadata.timestamp
      )
    };
    await this.writeRun(updated, runId);
  }

  public async getRun(runId: string): Promise<StoredRun | null> {
    if (!/^[a-f0-9-]{36}$/i.test(runId)) return null;
    const entries = await this.readRuns();
    const run = entries.find((entry) => entry.metadata.runId === runId);
    return run ? this.normalizeRunMetadata(run) : null;
  }

  public async listRuns(filters: RunHistoryFilters = {}): Promise<RunSummary[]> {
    const runs = await this.readRuns();
    return runs
      .filter((run) => !filters.mode || run.metadata.mode === filters.mode)
      .filter((run) => !filters.category || run.metadata.category === filters.category)
      .filter((run) => !filters.modelName || run.metadata.modelName === filters.modelName)
      .map((run) => this.toSummary(run))
      .sort((left, right) => right.metadata.timestamp.localeCompare(left.metadata.timestamp));
  }

  public async getAggregatedMetrics(filters: RunHistoryFilters = {}): Promise<AggregatedMetricsReport> {
    const runs = (await this.readRuns())
      .filter((run) => !filters.category || run.metadata.category === filters.category)
      .filter((run) => !filters.modelName || run.metadata.modelName === filters.modelName);
    const summaries = runs.map((run) => this.toSummary(run));
    const baseline = summaries.filter((run) => run.metadata.mode === 'BASELINE');
    const multiAgent = summaries.filter((run) => run.metadata.mode === 'MULTI_AGENT');
    const pairedTasks = this.buildPairs(baseline, multiAgent);
    const baselineFailuresInPairs = pairedTasks.filter((pair) => !pair.baseline.metrics.resolutionVerified).length;
    const recovered = pairedTasks.filter((pair) => pair.recoveredAfterRefinement).length;
    const approvedRuns = summaries.filter((run) => run.metadata.status === 'APPROVED');
    const successfulRuns = summaries.filter((run) => run.metrics.resolutionVerified);

    return {
      generatedAt: new Date().toISOString(),
      totalRuns: summaries.length,
      modes: {
        BASELINE: this.aggregateMode(baseline),
        MULTI_AGENT: this.aggregateMode(multiAgent)
      },
      autonomousRecoveryRatePct: baselineFailuresInPairs === 0 ? null : (recovered / baselineFailuresInPairs) * 100,
      baselineFailuresInPairs,
      averageTokenToFix: this.average(successfulRuns.map((run) => run.metrics.totalTokens)),
      averageOracleDurationMs: this.average(summaries.map((run) => run.metrics.oracleDurationMs)),
      averageCodeChurnLines: this.average(summaries.map((run) => run.metrics.addedLines + run.metrics.deletedLines)),
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
    } = {}
  ): Promise<{ baseline: RunSummary | null; multiAgent: RunSummary | null }> {
    const runs = (await this.listRuns(filters)).filter((run) =>
      run.metadata.taskId === taskId &&
      (!filters.apiBaseUrl || run.metadata.apiBaseUrl === filters.apiBaseUrl) &&
      (filters.seed === undefined || run.metadata.seed === filters.seed) &&
      (filters.temperature === undefined || run.metadata.temperature === filters.temperature) &&
      (filters.topP === undefined || run.metadata.topP === filters.topP)
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

  private isStoredRun(value: unknown): value is StoredRun {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Partial<StoredRun>;
    return candidate.schemaVersion === 1 &&
      typeof candidate.metadata?.runId === 'string' &&
      typeof candidate.metadata.taskId === 'string' &&
      (candidate.metadata.mode === 'BASELINE' || candidate.metadata.mode === 'MULTI_AGENT') &&
      typeof candidate.session?.taskId === 'string' &&
      Array.isArray(candidate.session.iterations);
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
    const legacyOracleDurationMs = session.iterations.reduce(
      (total, iteration) => total + (iteration.verification.semgrepDurationMs ?? 0) + iteration.verification.testReport.executionDurationMs,
      0
    );
    const telemetry = {
      ...session.cumulativeTelemetry,
      oracleDurationMs: Number.isFinite(session.cumulativeTelemetry.oracleDurationMs)
        ? session.cumulativeTelemetry.oracleDurationMs
        : legacyOracleDurationMs
    };
    const effectiveFrameworkDuration = getFrameworkDurationMs(telemetry);
    const endToEndOverheadPct = getEndToEndOverheadPct(telemetry);
    const activeFrameworkOverheadPct = getActiveFrameworkOverheadPct(telemetry);
    const finalVerification = session.iterations.at(-1)?.verification;
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
      timestamp,
      status: session.status,
      totalIterations: session.currentIteration,
      totalTokens: telemetry.promptTokens + telemetry.completionTokens,
      totalDurationMs: telemetry.totalDurationMs,
      inferenceDurationMs: telemetry.inferenceDurationMs,
      oracleDurationMs: telemetry.oracleDurationMs,
      frameworkDurationMs: effectiveFrameworkDuration,
      orchestrationOverheadMs: telemetry.orchestrationOverheadMs,
      endToEndOverheadPct,
      activeFrameworkOverheadPct,
      orchestrationOverheadBasis: 'NODE_PROCESS_CPU',
      isHumanAugmented: session.isHumanAugmented ?? false,
      resolutionVerified: finalVerification?.verified ?? false
    };
  }

  private toSummary(run: StoredRun): RunSummary {
    run = this.normalizeRunMetadata(run);
    const finalIteration = run.session.iterations.at(-1);
    const report = finalIteration?.verification.testReport;
    const totalLines = run.session.iterations.reduce(
      (totals, iteration) => ({
        added: totals.added + (iteration.patchChanges?.addedLines ?? this.countPatchLines(iteration.patchDiff).addedLines),
        deleted: totals.deleted + (iteration.patchChanges?.deletedLines ?? this.countPatchLines(iteration.patchDiff).deletedLines)
      }),
      { added: 0, deleted: 0 }
    );
    const findings = finalIteration?.verification.sastFindings ?? [];
    const grounding = run.session.iterations.reduce(
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
    const totalTests = report?.totalTests ?? 0;
    const agentUsage = run.session.cumulativeTelemetry.agentUsage ?? {
      CODER: { promptTokens: run.session.cumulativeTelemetry.promptTokens, completionTokens: run.session.cumulativeTelemetry.completionTokens, inferenceDurationMs: run.session.cumulativeTelemetry.inferenceDurationMs },
      REVIEWER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 }
    };
    const metadata = this.createMetadata(
      run.session,
      run.metadata.mode,
      run.modelConfig,
      run.metadata.category,
      run.metadata.runId,
      run.metadata.timestamp
    );

    return {
      metadata,
      metrics: {
        resolutionVerified: metadata.resolutionVerified,
        testPassRatePct: totalTests > 0 && report && !report.oracleFailed
          ? report.passRate * 100
          : null,
        testCounts: {
          total: totalTests,
          passed: report?.passedTests ?? 0,
          failed: report?.failedTests ?? 0,
          skipped: report?.skippedTests ?? 0,
          xfailed: report?.xfailedTests ?? 0,
          errors: report?.errorTests ?? 0
        },
        totalTests,
        passedTests: report?.passedTests ?? 0,
        failedTests: report?.failedTests ?? 0,
        skippedTests: report?.skippedTests ?? 0,
        xfailedTests: report?.xfailedTests ?? 0,
        errorTests: report?.errorTests ?? 0,
        residualSastCount: findings.length,
        sastErrors: findings.filter((finding) => finding.severity === 'ERROR').length,
        sastWarnings: findings.filter((finding) => finding.severity === 'WARNING').length,
        allPatchesApplicable: run.session.iterations.length > 0 && run.session.iterations.every((iteration) => iteration.isApplicable),
        fuzzyFallbackUsed: run.session.iterations.some((iteration) => iteration.fuzzyFallbackUsed ?? iteration.applyMode === 'FUZZY'),
        patchGrounding: grounding,
        hallucinationRatePct: grounding.oldSideLines > 0 ? (grounding.ungroundedLines / grounding.oldSideLines) * 100 : null,
        ungroundedHunkRatePct: grounding.hunks > 0 ? (grounding.ungroundedHunks / grounding.hunks) * 100 : null,
        patchFlappingDetected: run.session.iterations.some((iteration) => iteration.reviewerFeedback?.flappingDetected ?? false),
        addedLines: totalLines.added,
        deletedLines: totalLines.deleted,
        promptTokens: run.session.cumulativeTelemetry.promptTokens,
        completionTokens: run.session.cumulativeTelemetry.completionTokens,
        coderPromptTokens: agentUsage.CODER.promptTokens,
        coderCompletionTokens: agentUsage.CODER.completionTokens,
        reviewerPromptTokens: agentUsage.REVIEWER.promptTokens,
        reviewerCompletionTokens: agentUsage.REVIEWER.completionTokens,
        totalTokens: run.session.cumulativeTelemetry.promptTokens + run.session.cumulativeTelemetry.completionTokens,
        inferenceDurationMs: run.session.cumulativeTelemetry.inferenceDurationMs,
        oracleDurationMs: metadata.oracleDurationMs,
        endToEndOverheadPct: metadata.endToEndOverheadPct,
        activeFrameworkOverheadPct: metadata.activeFrameworkOverheadPct
      }
    };
  }

  private normalizeRunMetadata(run: StoredRun): StoredRun {
    const iterations = run.session.iterations.map((iteration) => {
      const report = iteration.verification.testReport as TestExecutionReport;
      const stdout = report.stdout ?? report.rawStdout ?? '';
      const stderr = report.stderr ?? report.rawStderr ?? '';
      const parsedSummary = parsePytestSummary(`${stdout}\n${stderr}`);
      const oracleFailed = report.oracleFailed ?? false;
      if (!parsedSummary) {
        const upgradedReport: TestExecutionReport = {
          ...report,
          exitCode: report.exitCode ?? null,
          suitePassed: false,
          timedOut: report.timedOut ?? false,
          oracleFailed: true,
          oracleFailureReason: report.oracleFailureReason ?? 'Report legacy privo di stdout Pytest verificabile.',
          skippedTests: report.skippedTests ?? 0,
          xfailedTests: report.xfailedTests ?? 0,
          errorTests: report.errorTests ?? 0,
          passRate: 0,
          durationMs: report.durationMs ?? report.executionDurationMs,
          stdout,
          stderr
        };
        return {
          ...iteration,
          verification: { ...iteration.verification, verified: false, testReport: upgradedReport }
        };
      }

      const exitCode = report.exitCode ?? (parsedSummary.failedTests + parsedSummary.errorTests > 0 ? 1 : 0);
      const suitePassed = !oracleFailed &&
        exitCode === 0 &&
        parsedSummary.passedTests > 0 &&
        parsedSummary.failedTests === 0 &&
        parsedSummary.skippedTests === 0 &&
        parsedSummary.xfailedTests === 0 &&
        parsedSummary.errorTests === 0 &&
        parsedSummary.passedTests === parsedSummary.totalTests;
      const upgradedReport: TestExecutionReport = {
        ...report,
        exitCode,
        suitePassed,
        timedOut: report.timedOut ?? false,
        oracleFailed,
        totalTests: parsedSummary.totalTests,
        passedTests: parsedSummary.passedTests,
        failedTests: parsedSummary.failedTests,
        skippedTests: parsedSummary.skippedTests,
        xfailedTests: parsedSummary.xfailedTests,
        errorTests: parsedSummary.errorTests,
        passRate: parsedSummary.totalTests > 0 ? parsedSummary.passedTests / parsedSummary.totalTests : 0,
        durationMs: report.durationMs ?? report.executionDurationMs,
        stdout,
        stderr
      };
      return {
        ...iteration,
        verification: {
          ...iteration.verification,
          verified: iteration.verification.verified && suitePassed,
          testReport: upgradedReport
        }
      };
    });
    const finalIterationVerified = iterations.at(-1)?.verification.verified ?? false;
    const status = run.session.status === 'CONVERGED' && !finalIterationVerified
      ? 'FAILED'
      : run.session.status;
    const upgradedSession: WorkbenchSessionState = { ...run.session, iterations, status };
    const legacyOracleDurationMs = upgradedSession.iterations.reduce(
      (total, iteration) => total + (iteration.verification.semgrepDurationMs ?? 0) + iteration.verification.testReport.executionDurationMs,
      0
    );
    const telemetry = upgradedSession.cumulativeTelemetry;
    const cumulativeTelemetry = {
      ...telemetry,
      oracleDurationMs: typeof telemetry.oracleDurationMs === 'number' && Number.isFinite(telemetry.oracleDurationMs)
        ? telemetry.oracleDurationMs
        : legacyOracleDurationMs,
      agentUsage: telemetry.agentUsage ?? {
        CODER: {
          promptTokens: telemetry.promptTokens,
          completionTokens: telemetry.completionTokens,
          inferenceDurationMs: telemetry.inferenceDurationMs
        },
        REVIEWER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 }
      }
    };
    const session: WorkbenchSessionState = { ...upgradedSession, cumulativeTelemetry };
    return {
      ...run,
      session,
      metadata: this.createMetadata(
        session,
        run.metadata.mode,
        run.modelConfig,
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

  private aggregateMode(runs: readonly RunSummary[]): ModeAggregateMetrics {
    const pooledRate = (numerator: number, denominator: number): number | null =>
      denominator > 0 ? (numerator / denominator) * 100 : null;

    const resolvedRuns = runs.filter((run) => run.metrics.resolutionVerified);
    const distribution = { '1': 0, '2': 0, '3': 0, N_MAX: 0 };
    for (const run of runs) {
      const iterations = run.metadata.totalIterations;
      if (!run.metrics.resolutionVerified && iterations >= 3) distribution.N_MAX += 1;
      else if (iterations <= 1) distribution['1'] += 1;
      else if (iterations === 2) distribution['2'] += 1;
      else distribution['3'] += 1;
    }
    return {
      runCount: runs.length,
      resolvedCount: resolvedRuns.length,
      successRatePct: runs.length === 0 ? null : (resolvedRuns.length / runs.length) * 100,
      averageSuccessfulTokens: this.average(resolvedRuns.map((run) => run.metrics.totalTokens)),
      averageInferenceDurationMs: this.average(runs.map((run) => run.metrics.inferenceDurationMs)),
      averageOracleDurationMs: this.average(runs.map((run) => run.metrics.oracleDurationMs)),
      averageEndToEndOverheadPct: this.average(runs.map((run) => run.metrics.endToEndOverheadPct).filter((value): value is number => value !== null)),
      averageActiveFrameworkOverheadPct: this.average(runs.map((run) => run.metrics.activeFrameworkOverheadPct).filter((value): value is number => value !== null)),
      averageResidualSastFindings: this.average(runs.map((run) => run.metrics.residualSastCount)),
      averageAddedLines: this.average(runs.map((run) => run.metrics.addedLines)),
      averageDeletedLines: this.average(runs.map((run) => run.metrics.deletedLines)),
      hallucinationRatePct: pooledRate(runs.reduce((sum, run) => sum + run.metrics.patchGrounding.ungroundedLines, 0), runs.reduce((sum, run) => sum + run.metrics.patchGrounding.oldSideLines, 0)),
      ungroundedHunkRatePct: pooledRate(runs.reduce((sum, run) => sum + run.metrics.patchGrounding.ungroundedHunks, 0), runs.reduce((sum, run) => sum + run.metrics.patchGrounding.hunks, 0)),
      convergenceDistribution: distribution
    };
  }

  private buildPairs(baselineRuns: readonly RunSummary[], multiRuns: readonly RunSummary[]): PairedTaskMetrics[] {
    const latestBaseline = this.latestByKey(baselineRuns);
    const latestMulti = this.latestByKey(multiRuns);
    const pairs: PairedTaskMetrics[] = [];
    for (const [key, baseline] of latestBaseline) {
      const multiAgent = latestMulti.get(key);
      if (!multiAgent) continue;
      const recoveredAfterRefinement = !baseline.metrics.resolutionVerified &&
        multiAgent.metrics.resolutionVerified && multiAgent.metadata.totalIterations > 1;
      const pairKey = [
        baseline.metadata.taskId,
        baseline.metadata.category,
        baseline.metadata.modelName,
        baseline.metadata.apiBaseUrl,
        baseline.metadata.seed,
        baseline.metadata.temperature,
        baseline.metadata.topP
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
        run.metadata.taskId,
        run.metadata.category,
        run.metadata.modelName,
        run.metadata.apiBaseUrl,
        run.metadata.seed,
        run.metadata.temperature,
        run.metadata.topP
      ].join('\0');
      const current = latest.get(key);
      if (!current || current.metadata.timestamp < run.metadata.timestamp) latest.set(key, run);
    }
    return latest;
  }

  private average(values: readonly number[]): number | null {
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
  }
}
