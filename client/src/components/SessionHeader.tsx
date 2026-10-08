import React from 'react';

interface Props {
  readonly taskId: string;
  readonly status: string;
  readonly targetFiles: readonly string[];
  readonly currentPhase: string;
  readonly iterationsCount: number;
  readonly selectedIteration: number;
  readonly onSelectIteration: (iter: number) => void;
}

export const SessionHeader: React.FC<Props> = ({
  taskId,
  status,
  targetFiles,
  currentPhase,
  iterationsCount,
  selectedIteration,
  onSelectIteration
}) => {
  const getBadgeColor = (s: string) => {
    switch (s) {
      case 'CONVERGED':
      case 'APPROVED': return '#4ec9b0';
      case 'FAILED':
      case 'REJECTED': return '#f48771';
      case 'UNRESOLVED': return '#cca700';
      default: return '#007acc';
    }
  };

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', fontWeight: 600 }}>
              Task Session: <code style={{ color: '#9cdcfe' }}>{taskId || 'IDLE'}</code>
            </h1>
            <span style={{
              background: getBadgeColor(status),
              color: '#111',
              padding: '3px 8px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              letterSpacing: '0.5px'
            }}>
              {status}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
            Target: <code>{targetFiles.join(', ') || 'service.py'}</code> | FSM State: <strong style={{ color: '#dcdcaa' }}>{currentPhase}</strong>
          </div>
        </div>
        {iterationsCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '0.8rem', color: '#aaa', marginRight: '6px' }}>Storico Tentativi:</span>
            {Array.from({ length: iterationsCount }, (_, i) => i + 1).map((iter) => (
              <button
                key={iter}
                onClick={() => onSelectIteration(iter)}
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
