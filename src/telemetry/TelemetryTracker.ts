import { AgentRole, AgentUsage, ComputationalTelemetry } from '../types/domain.js';
import { getEndToEndOverheadPct } from './AnalyticsMetrics.js';

const emptyAgentUsage = (): Record<AgentRole, { promptTokens: number; completionTokens: number; inferenceDurationMs: number }> => ({
  CODER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 },
  REVIEWER: { promptTokens: 0, completionTokens: 0, inferenceDurationMs: 0 }
});

export class TelemetryTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private inferenceDurationMs = 0;
  private oracleDurationMs = 0;
  private orchestrationOverheadMs = 0;
  private readonly agentUsage = emptyAgentUsage();
  private iterationAgentUsage = emptyAgentUsage();
  private readonly startWallClock: number;

  constructor() {
    this.startWallClock = performance.now();
  }

  public recordLLMUsage(role: AgentRole, promptTokens: number, completionTokens: number, durationMs: number): void {
    this.promptTokens += promptTokens;
    this.completionTokens += completionTokens;
    this.inferenceDurationMs += durationMs;
    for (const usage of [this.agentUsage[role], this.iterationAgentUsage[role]]) {
      usage.promptTokens += promptTokens;
      usage.completionTokens += completionTokens;
      usage.inferenceDurationMs += durationMs;
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

  public recordOrchestrationCpu(start: NodeJS.CpuUsage): void {
    const usage = process.cpuUsage(start);
    this.orchestrationOverheadMs += (usage.user + usage.system) / 1000;
  }

  public recordOracleDuration(durationMs: number): void {
    this.oracleDurationMs += durationMs;
  }

  public getSnapshot(): ComputationalTelemetry {
    const totalDurationMs = performance.now() - this.startWallClock;
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      inferenceDurationMs: Math.round(this.inferenceDurationMs * 100) / 100,
      oracleDurationMs: Math.round(this.oracleDurationMs * 100) / 100,
      orchestrationOverheadMs: Math.round(this.orchestrationOverheadMs * 100) / 100,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100,
      agentUsage: this.copyAgentUsage(this.agentUsage)
    };
  }

  private copyAgentUsage(
    source: Record<AgentRole, { promptTokens: number; completionTokens: number; inferenceDurationMs: number }>
  ): Readonly<Record<AgentRole, AgentUsage>> {
    return {
      CODER: { ...source.CODER },
      REVIEWER: { ...source.REVIEWER }
    };
  }

  /**
   * Convalida il vincolo RNF-05: l'overhead di orchestrazione deve essere < 5% del tempo totale.
   */
  public isOverheadCompliant(): boolean {
    const overheadPct = getEndToEndOverheadPct(this.getSnapshot());
    return overheadPct !== null && overheadPct <= 5;
  }
}
