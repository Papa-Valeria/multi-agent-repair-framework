import { AgentRole, AgentUsage, ComputationalTelemetry } from '../types/domain.js';

interface MutableAgentUsage {
  promptTokens: number;
  completionTokens: number;
  tokenUsageAvailable: boolean;
  inferenceDurationMs: number;
}

const emptyAgentUsage = (): Record<AgentRole, MutableAgentUsage> => ({
  CODER: { promptTokens: 0, completionTokens: 0, tokenUsageAvailable: true, inferenceDurationMs: 0 },
  REVIEWER: { promptTokens: 0, completionTokens: 0, tokenUsageAvailable: true, inferenceDurationMs: 0 }
});

export class TelemetryTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private tokenUsageAvailable = true;
  private inferenceDurationMs = 0;
  private oracleDurationMs: number | null = null;
  private oracleDurationAvailable = false;
  private orchestrationOverheadMs = 0;
  private readonly agentUsage = emptyAgentUsage();
  private iterationAgentUsage = emptyAgentUsage();
  private startWallClock: number | undefined;

  public startRun(): void {
    if (this.startWallClock !== undefined) {
      throw new Error('La telemetria del run è già stata avviata.');
    }

    this.startWallClock = performance.now();
  }

  public recordLLMUsage(role: AgentRole, promptTokens: number | null, completionTokens: number | null, durationMs: number): void {
    this.assertValidDuration(durationMs, 'durationMs');
    if (promptTokens !== null) {
      this.assertValidTokenCount(promptTokens, 'promptTokens');
    }
    if (completionTokens !== null) {
      this.assertValidTokenCount(completionTokens, 'completionTokens');
    }
    this.inferenceDurationMs += durationMs;
    const usageTargets = [
      this.agentUsage[role],
      this.iterationAgentUsage[role]
    ];

    for (const usage of usageTargets) {
      usage.inferenceDurationMs += durationMs;
    }

    const completeUsageAvailable = promptTokens !== null && completionTokens !== null;

    if (!completeUsageAvailable) {
      this.tokenUsageAvailable = false;

      for (const usage of usageTargets) {
        usage.tokenUsageAvailable = false;
      }

      return;
    }

    this.promptTokens += promptTokens;
    this.completionTokens += completionTokens;

    for (const usage of usageTargets) {
      usage.promptTokens += promptTokens;
      usage.completionTokens += completionTokens;
    }
  }

  public startIteration(): void {
    this.iterationAgentUsage = emptyAgentUsage();
  }

  public getIterationAgentUsage(): Readonly<Record<AgentRole, AgentUsage>> {
    return this.copyAgentUsage(this.iterationAgentUsage);
  }

  public startCpuMeasurement(): NodeJS.CpuUsage {
    return process.cpuUsage();
  }

  public recordOrchestrationCpu(
    start: NodeJS.CpuUsage
  ): void {
    const usage =
      process.cpuUsage(start);

    const durationMs =
      (
        usage.user +
        usage.system
      ) / 1_000;

    this.assertValidDuration(
      durationMs,
      'orchestrationOverheadMs'
    );

    this.orchestrationOverheadMs +=
      durationMs;
  }

  public recordOracleDuration(
    durationMs: number
  ): void {
    this.assertValidDuration(
      durationMs,
      'oracleDurationMs'
    );

    if (
      this.oracleDurationMs === null
    ) {
      this.oracleDurationMs =
        durationMs;
    } else {
      this.oracleDurationMs +=
        durationMs;
    }

    this.oracleDurationAvailable =
      true;
  }

  public getSnapshot(): ComputationalTelemetry {
    const totalDurationMs = this.startWallClock !== undefined
      ? performance.now() - this.startWallClock
      : 0;

    return {
      promptTokens: this.tokenUsageAvailable ? this.promptTokens : null,
      completionTokens: this.tokenUsageAvailable ? this.completionTokens : null,
      tokenUsageAvailable: this.tokenUsageAvailable,
      inferenceDurationMs: Math.round(this.inferenceDurationMs * 100) / 100,
      oracleDurationMs:
        this.oracleDurationAvailable &&
          this.oracleDurationMs !== null
          ? Math.round(
            this.oracleDurationMs * 100
          ) / 100
          : null,

      oracleDurationAvailable:
        this.oracleDurationAvailable,
      orchestrationOverheadMs: Math.round(this.orchestrationOverheadMs * 100) / 100,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      agentUsage: this.copyAgentUsage(this.agentUsage)
    };
  }

  private assertValidDuration(
    value: number,
    fieldName: string
  ): void {
    if (
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new Error(
        `${fieldName} deve essere finito e non negativo.`
      );
    }
  }

  private assertValidTokenCount(
    value: number,
    fieldName: string
  ): void {
    if (
      !Number.isInteger(value) ||
      value < 0
    ) {
      throw new Error(
        `${fieldName} deve essere un intero non negativo.`
      );
    }
  }

  private copyAgentUsage(source: Record<AgentRole, MutableAgentUsage>): Readonly<Record<AgentRole, AgentUsage>> {
    return {
      CODER: this.copySingleAgentUsage(source.CODER),
      REVIEWER: this.copySingleAgentUsage(source.REVIEWER)
    };
  }

  private copySingleAgentUsage(source: MutableAgentUsage): AgentUsage {
    return {
      promptTokens: source.tokenUsageAvailable ? source.promptTokens : null,
      completionTokens: source.tokenUsageAvailable ? source.completionTokens : null,
      tokenUsageAvailable: source.tokenUsageAvailable,
      inferenceDurationMs: source.inferenceDurationMs
    };
  }
}
