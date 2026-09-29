import React from 'react';
import { ComputationalTelemetry } from '../types/domain.js';

interface Props {
  readonly telemetry: ComputationalTelemetry;
  readonly currentIteration: number;
  readonly maxIterations: number;
}

export const TelemetryHUD: React.FC<Props> = ({ telemetry, currentIteration, maxIterations }) => {
  const overheadPct = telemetry.totalDurationMs > 0
    ? ((telemetry.orchestrationOverheadMs / telemetry.totalDurationMs) * 100).toFixed(2)
    : '0.00';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', background: '#252526', padding: '12px', borderRadius: '4px', color: '#fff', marginBottom: '15px' }}>
      <div>
        <small style={{ color: '#888' }}>Iterazione FSM</small>
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{currentIteration} / {maxIterations}</div>
      </div>
      <div>
        <small style={{ color: '#888' }}>Token Footprint</small>
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
          Prompt: {telemetry.promptTokens} | Compl: {telemetry.completionTokens}
        </div>
      </div>
      <div>
        <small style={{ color: '#888' }}>Latenza Inferenza</small>
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{telemetry.inferenceDurationMs} ms</div>
      </div>
      <div>
        <small style={{ color: '#888' }}>Overhead Orchestrazione (RNF-05)</small>
        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: Number(overheadPct) <= 5.0 ? '#4ec9b0' : '#f48771' }}>
          {telemetry.orchestrationOverheadMs} ms ({overheadPct}%)
        </div>
      </div>
    </div>
  );
};
