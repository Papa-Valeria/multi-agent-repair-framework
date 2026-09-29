import { ComputationalTelemetry } from '../types/domain.js';

export class TelemetryTracker {
  private promptTokens = 0;
  private completionTokens = 0;
  private inferenceDurationMs = 0;
  private orchestrationOverheadMs = 0;
  private readonly startWallClock: number;

  constructor() {
    this.startWallClock = performance.now();
  }

  public recordLLMUsage(promptTokens: number, completionTokens: number, durationMs: number): void {
    this.promptTokens += promptTokens;
    this.completionTokens += completionTokens;
    this.inferenceDurationMs += durationMs;
  }

  public recordOverhead(durationMs: number): void {
    this.orchestrationOverheadMs += durationMs;
  }

  public getSnapshot(): ComputationalTelemetry {
    const totalDurationMs = performance.now() - this.startWallClock;
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      inferenceDurationMs: Math.round(this.inferenceDurationMs * 100) / 100,
      orchestrationOverheadMs: Math.round(this.orchestrationOverheadMs * 100) / 100,
      totalDurationMs: Math.round(totalDurationMs * 100) / 100
    };
  }

  /**
   * Convalida il vincolo RNF-05: l'overhead di orchestrazione deve essere < 5% del tempo totale.
   */
  public isOverheadCompliant(): boolean {
    const snapshot = this.getSnapshot();
    if (snapshot.totalDurationMs === 0) return true;
    return (snapshot.orchestrationOverheadMs / snapshot.totalDurationMs) <= 0.05;
  }
}
