import React from 'react';
import { ComputationalTelemetry } from '../types.js';
import {
  getActiveFrameworkOverheadPct,
  getEndToEndOverheadPct
} from '../../../src/telemetry/AnalyticsMetrics.js';

interface Props {
  readonly telemetry: ComputationalTelemetry;
  readonly overallTelemetry?: ComputationalTelemetry | undefined;
  readonly currentIteration: number;
  readonly maxIterations: number;
}

export const TelemetryHUD: React.FC<Props> = ({ telemetry, overallTelemetry, currentIteration, maxIterations }) => {
  const overhead = getEndToEndOverheadPct(overallTelemetry ?? telemetry);
  const activeOverhead = getActiveFrameworkOverheadPct(overallTelemetry ?? telemetry);
  const overheadPct = overhead === null ? 'n/d' : overhead.toFixed(2);

  const isCompliant = overhead !== null && overhead <= 5.0;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '12px',
      background: '#252526',
      padding: '12px 18px',
      borderRadius: '4px',
      border: '1px solid #333'
    }}>
      <div>
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>Ciclo di Raffinamento</span>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#fff' }}>
          {currentIteration} <span style={{ fontSize: '0.85rem', color: '#888' }}>/ {maxIterations}</span>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>Token Footprint (RNF-02)</span>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#fff' }}>
          {telemetry.promptTokens + telemetry.completionTokens}{' '}
          <span style={{ fontSize: '0.75rem', color: '#888' }}>
            ({telemetry.promptTokens} in / {telemetry.completionTokens} out)
          </span>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>Latenza Inferenza LLM</span>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#fff' }}>
          {(telemetry.inferenceDurationMs / 1000).toFixed(2)}{' '}
          <span style={{ fontSize: '0.75rem', color: '#888' }}>sec</span>
        </div>
      </div>

      <div>
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>Overhead end-to-end (RNF-05)</span>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: isCompliant ? '#4ec9b0' : '#f48771' }}>
          {overhead === null ? overheadPct : `${overheadPct}%`}{' '}
          <span style={{ fontSize: '0.75rem', color: isCompliant ? '#4ec9b0' : '#f48771' }}>
            {overhead === null
              ? '(Dati insufficienti)'
              : `${isCompliant ? '(Conforme <=5%)' : '(Sopra soglia)'} · attivo ${activeOverhead === null ? 'n/d' : `${activeOverhead.toFixed(2)}%`}`}
          </span>
        </div>
      </div>
    </div>
  );
};
