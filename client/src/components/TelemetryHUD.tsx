import React from 'react';
import type { ComputationalTelemetry } from '../types.js';

interface Props {
  readonly telemetry: ComputationalTelemetry;
  readonly overallTelemetry?: ComputationalTelemetry | undefined;
  readonly currentIteration: number;
  readonly maxIterations: number;
}

export const TelemetryHUD: React.FC<Props> = ({ telemetry, overallTelemetry, currentIteration, maxIterations }) => {

  const hasObservedTokenUsage = telemetry.tokenUsageAvailable && telemetry.promptTokens !== null && telemetry.completionTokens !== null;
  const totalTokens = hasObservedTokenUsage ? telemetry.promptTokens + telemetry.completionTokens : null;
  const hasObservedOracleDuration = telemetry.oracleDurationAvailable && telemetry.oracleDurationMs !== null;
  const displayedTelemetry = overallTelemetry ?? telemetry;


  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
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
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>Token Footprint</span>
        {hasObservedTokenUsage && totalTokens !== null ? (
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#fff' }}>
            {totalTokens}{' '}
            <span style={{ fontSize: '0.75rem', color: '#888' }}>
              ({telemetry.promptTokens} in / {telemetry.completionTokens} out)
            </span>
          </div>
        ) : (
          <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#aaa' }}>
            n/d{' '}
            <span style={{ fontSize: '0.75rem', color: '#888' }}>(token usage non disponibile)</span>
          </div>
        )}
      </div>

      <div>
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>Latenza Inferenza LLM</span>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#fff' }}>
          {(telemetry.inferenceDurationMs / 1000).toFixed(2)}{' '}
          <span style={{ fontSize: '0.75rem', color: '#888' }}>sec</span>
        </div>
      </div>

      <div>
        <span
          style={{
            fontSize: '0.75rem',
            color: '#888',
            display: 'block'
          }}
        >
          Oracle duration
        </span>

        {hasObservedOracleDuration ? (
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 600,
              color: '#fff'
            }}
          >
            {telemetry.oracleDurationMs.toFixed(1)}{' '}
            <span
              style={{
                fontSize: '0.75rem',
                color: '#888'
              }}
            >
              ms
            </span>
          </div>
        ) : (
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 600,
              color: '#aaa'
            }}
          >
            n/d{' '}
            <span
              style={{
                fontSize: '0.75rem',
                color: '#888'
              }}
            >
              (durata Oracle non disponibile)
            </span>
          </div>
        )}
      </div>


      <div>
        <span style={{ fontSize: '0.75rem', color: '#888', display: 'block' }}>CPU orchestrazione framework</span>
        <div style={{ fontSize: '1.2rem', fontWeight: 600, color: '#fff' }}>
          {displayedTelemetry.orchestrationOverheadMs.toFixed(1)}{' '}
          <span style={{ fontSize: '0.75rem', color: '#888' }}>
            ms · NODE_PROCESS_CPU
          </span>
        </div>
      </div>
    </div>
  );
};
