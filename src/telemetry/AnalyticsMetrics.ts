export type OverheadTelemetry = Pick<
  import('../types/domain.js').ComputationalTelemetry,
  'totalDurationMs' | 'inferenceDurationMs' | 'oracleDurationMs' | 'orchestrationOverheadMs'
>;

export function getFrameworkDurationMs(telemetry: OverheadTelemetry): number {
  return Math.max(
    0,
    telemetry.totalDurationMs - telemetry.inferenceDurationMs - telemetry.oracleDurationMs
  );
}

export function getEndToEndOverheadPct(telemetry: OverheadTelemetry): number | null {
  return telemetry.totalDurationMs > 0
    ? (telemetry.orchestrationOverheadMs / telemetry.totalDurationMs) * 100
    : null;
}

export function getActiveFrameworkOverheadPct(telemetry: OverheadTelemetry): number | null {
  const frameworkDurationMs = getFrameworkDurationMs(telemetry);
  return frameworkDurationMs > 0
    ? (telemetry.orchestrationOverheadMs / frameworkDurationMs) * 100
    : null;
}
