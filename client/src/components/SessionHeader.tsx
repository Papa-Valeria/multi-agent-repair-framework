import React from 'react';
import type {
  AutonomousPipelineStatus,
  LivePipelinePhase,
  PipelineFinalizationStatus
} from '../types.js';


interface Props {
  readonly taskId: string;
  readonly autonomousStatus: AutonomousPipelineStatus | null;
  readonly finalizationStatus: PipelineFinalizationStatus;
  readonly isHumanAugmented: boolean;
  readonly targetFiles: readonly string[];
  readonly livePhase: LivePipelinePhase | null;
  readonly iterationsCount: number;
  readonly selectedIteration: number;
  readonly onSelectIteration: (iter: number) => void;
}

export const SessionHeader: React.FC<Props> = ({
  taskId,
  autonomousStatus,
  finalizationStatus,
  isHumanAugmented,
  targetFiles,
  livePhase,
  iterationsCount,
  selectedIteration,
  onSelectIteration
}) => {
  const targetLabel = targetFiles.length > 0 ? targetFiles.join(', ') : 'Nessun target';
  const phaseLabel = livePhase ?? 'IDLE';
  return (
    <header style={{
      background: '#1f1f1f',
      borderBottom: '1px solid #333',
      padding: '14px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', fontWeight: 600 }}>
              Task Session:{' '}<code style={{ color: '#9cdcfe' }}>{taskId || 'IDLE'}</code>
            </h1>
            <StatusBadge
              label={autonomousStatus ?? 'INATTIVO'}
              color={autonomousStatus === null ? '#007ACC' : autonomousStatusColor(autonomousStatus)}
            />
            <StatusBadge
              label={finalizationStatus}
              color={finalizationStatusColor(finalizationStatus)}
            />
            {isHumanAugmented && (
              <StatusBadge
                label="HUMAN-AUGMENTED"
                color="#c586c0"
              />
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
            Target:{' '}<code>{targetLabel}</code>{' | '}FSM State:{' '}<strong style={{ color: '#dcdcaa' }}>{phaseLabel}</strong>
          </div>
        </div>
        {iterationsCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: '#aaa', marginRight: '6px' }}>Storico Tentativi:</span>
            {Array.from({ length: iterationsCount }, (_, i) => i + 1).map((iter) => (
              <button
                key={iter}
                type='button'
                onClick={() => onSelectIteration(iter)}
                aria-pressed={selectedIteration === iter}
                style={{
                  background: selectedIteration === iter ? '#0e639c' : '#2d2d2d',
                  color: selectedIteration === iter ? '#fff' : '#aaa',
                  border: '1px solid',
                  borderColor: selectedIteration === iter ? '#1177bb' : '#444',
                  padding: '4px 10px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: selectedIteration === iter ? 'bold' : 'normal'
                }}
              >
                Iterazione #{iter}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
};

function StatusBadge({ label, color }: { readonly label: string | null; readonly color: string; }): React.JSX.Element {
  return (
    <span
      style={{
        background: color,
        color: '#111',
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        letterSpacing: '0.5px'
      }}
    >
      {label}
    </span>
  );
}

function autonomousStatusColor(status: AutonomousPipelineStatus): string {
  switch (status) {
    case 'CONVERGED':
      return '#4ec9b0';
    case 'UNRESOLVED':
      return '#cca700';
    case 'FAILED':
      return '#f48771';
    case 'INFRASTRUCTURE_ERROR':
      return '#d16969';
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
  }
}
