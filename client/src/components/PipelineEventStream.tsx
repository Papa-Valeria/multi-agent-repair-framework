import React from 'react';

interface PipelineEventStreamProps {
  readonly logs: readonly string[];
  readonly isRunning: boolean;
}

export const PipelineEventStream: React.FC<PipelineEventStreamProps> = ({ logs, isRunning }) => {
  if (logs.length === 0 && !isRunning) {
    return null;
  }

  return (
    <details
      open={isRunning}
      style={{
        background: '#212121',
        border: '1px solid #333',
        borderRadius: 4,
        overflow: 'hidden'
      }}
    >
      <summary
        style={{
          padding: '10px 14px',
          fontSize: '0.78rem',
          color: '#aaa',
          cursor: 'pointer',
          fontWeight: 700,
          borderBottom: isRunning
            ? '1px solid #333'
            : undefined
        }}
      >
        Pipeline Event Stream
        {isRunning ? ' - LIVE' : ''}
        {logs.length > 0
          ? ` (${logs.length})`
          : ''}
      </summary>

      <div
        style={{
          maxHeight: 180,
          overflowY: 'auto',
          padding: '8px 12px',
          background: '#1e1e1e',
          fontSize: '0.72rem',
          fontFamily: 'monospace'
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: '#777' }}>
            In attesa di eventi...
          </div>
        ) : (
          logs.map((log, idx) => {
            const isFsm = log.startsWith('[FSM]');
            const isOracle = log.startsWith('[Oracle]');
            const isInfrastructure = log.startsWith('[Infrastructure]');
            const isExecution = log.startsWith('[Execution]');
            const logColor =
              isInfrastructure || isExecution
                ? '#f48771'
                : isOracle
                  ? '#4ec9b0'
                  : isFsm
                    ? '#9cdcfe'
                    : '#bbb';

            return (
              <div
                key={`${idx}-${log}`}
                style={{
                  padding: '2px 0',
                  color: logColor,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere'
                }}
              >
                {log}
              </div>
            );
          })
        )}
      </div>
    </details>
  );
};

