import React from 'react';
import type {
  AutonomousPipelineStatus,
  LivePipelinePhase,
  PipelineFinalizationStatus
} from '../types.js';


export type PipelineTone = | 'NEUTRAL' | 'RUNNING' | 'SUCCESS' | 'ERROR' | 'WARNING';

export interface PipelinePresentation {
  readonly label: string;
  readonly tone: PipelineTone;
}

interface PipelineStatusPanelProps {
  readonly livePhase: LivePipelinePhase | null;
  readonly autonomousStatus: AutonomousPipelineStatus | null;
  readonly finalizationStatus: PipelineFinalizationStatus;
  readonly isRunning: boolean;
  readonly replayRunId: string | null;
  readonly executionMode: | 'BASELINE' | 'MULTI_AGENT' | null;
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly selectedIteration: number;
  readonly hasIterations: boolean;
}

export const PipelineStatusPanel: React.FC<PipelineStatusPanelProps> = ({
  livePhase,
  autonomousStatus,
  finalizationStatus,
  isRunning,
  replayRunId,
  executionMode,
  currentIteration,
  maxIterations,
  selectedIteration,
  hasIterations
}) => {
  const presentation = pipelinePresentation(livePhase, autonomousStatus, isRunning, replayRunId);
  const color = pipelineToneColor(presentation.tone);

  return (
    <section
      aria-label="Stato pipeline"
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(0, 1fr) auto auto auto auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        background: '#202020',
        border: '1px solid #333',
        borderRadius: 4
      }}
    >
      <div
        style={{
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: color,
            boxShadow: isRunning
              ? `0 0 8px ${color}`
              : 'none',
            flexShrink: 0
          }}
        />

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: '#eee',
              fontSize: '0.78rem',
              fontWeight: 700
            }}
          >
            Pipeline FSM
          </div>

          <div
            style={{
              marginTop: 2,
              color,
              fontFamily: 'monospace',
              fontSize: '0.7rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={presentation.label}
          >
            {presentation.label}
          </div>
        </div>
      </div>
      <Metric
        label="Finalizzazione"
        value={finalizationStatus}
        color={
          finalizationStatusColor(
            finalizationStatus
          )
        }
      />

      <Metric
        label="Strategia"
        value={executionMode ?? '-'}
        color={
          executionMode === 'MULTI_AGENT'
            ? '#4a9fd2'
            : '#bbb'
        }
      />

      <Metric
        label="Iterazione sessione"
        value={
          maxIterations > 0
            ? `${currentIteration}/${maxIterations}`
            : '-'
        }
      />

      <Metric
        label="Vista"
        value={
          hasIterations
            ? `Iter ${selectedIteration}`
            : '-'
        }
      />
    </section>
  );
};

function Metric({
  label,
  value,
  color = '#ddd'
}: {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right' }}>
      <div
        style={{
          color: '#777',
          fontSize: '0.62rem',
          textTransform: 'uppercase'
        }}
      >
        {label}
      </div>

      <div
        style={{
          marginTop: 2,
          color,
          fontFamily: 'monospace',
          fontSize: '0.72rem'
        }}
      >
        {value}
      </div>
    </div>
  );
}

function pipelinePresentation(
  livePhase: LivePipelinePhase | null,
  autonomousStatus:
    AutonomousPipelineStatus | null,
  isRunning: boolean,
  replayRunId: string | null
): PipelinePresentation {
  if (replayRunId) {
    return autonomousStatus !== null
      ? {
        label: autonomousStatus,
        tone:
          autonomousStatusTone(
            autonomousStatus
          )
      }
      : {
        label: 'REPLAY',
        tone: 'NEUTRAL'
      };
  }

  if (isRunning) {
    return {
      label: livePhase ?? 'RUNNING',
      tone: 'RUNNING'
    };
  }

  if (autonomousStatus !== null) {
    return {
      label: autonomousStatus,
      tone:
        autonomousStatusTone(
          autonomousStatus
        )
    };
  }

  return {
    label: livePhase ?? 'IDLE',
    tone: 'NEUTRAL'
  };
}

function assertNever(
  value: never
): never {
  throw new Error(
    `Stato pipeline non gestito: ${String(value)}`
  );
}

function autonomousStatusTone(
  status: AutonomousPipelineStatus
): PipelineTone {
  switch (status) {
    case 'CONVERGED':
      return 'SUCCESS';

    case 'UNRESOLVED':
      return 'WARNING';

    case 'FAILED':
    case 'INFRASTRUCTURE_ERROR':
      return 'ERROR';

    default:
      return assertNever(status);
  }
}


function finalizationStatusColor(status: PipelineFinalizationStatus): string {
  switch (status) {
    case 'NOT_FINALIZED':
      return '#9d9d9d';

    case 'APPROVED':
      return '#4ec9b0';

    case 'REJECTED':
      return '#f48771';

    default:
      return assertNever(status);
  }

}

function pipelineToneColor(tone: PipelineTone): string {
  switch (tone) {
    case 'RUNNING':
      return '#4a9fd2';
    case 'SUCCESS':
      return '#4ec9b0';
    case 'ERROR':
      return '#f48771';
    case 'WARNING':
      return '#dcdcaa';
    default:
      return '#9d9d9d';
  }
}
