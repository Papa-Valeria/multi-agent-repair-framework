import React from 'react';

interface Props {
  readonly isConverged: boolean;
  readonly isHumanAugmented?: boolean | undefined;
  readonly isApproved: boolean;
  readonly canReject: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
}

export const ActionToolbar: React.FC<Props> = ({
  isConverged,
  isHumanAugmented,
  isApproved,
  canReject,
  onApprove,
  onReject
}) => {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '14px 0 0 0',
      borderTop: '1px solid #333',
      marginTop: '16px'
    }}>
      <div style={{ fontSize: '0.8rem', color: '#888' }}>
        Presidio Human-in-the-Loop (HITL): nessuna modifica fluisce su <code>main</code> senza firma esplicita dello sviluppatore.
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={onReject}
          disabled={!canReject}
          style={{
            background: '#a1260d',
            color: '#fff',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '4px',
            cursor: canReject ? 'pointer' : 'not-allowed',
            opacity: canReject ? 1 : 0.5,
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          Scarta e Ripristina (git reset)
        </button>
        <button
          onClick={onApprove}
          disabled={isApproved || (!isConverged && !isHumanAugmented)}
          style={{
            background: (!isApproved && (isConverged || isHumanAugmented)) ? '#2e7d32' : '#223824',
            color: (!isApproved && (isConverged || isHumanAugmented)) ? '#fff' : '#666',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '4px',
            cursor: (!isApproved && (isConverged || isHumanAugmented)) ? 'pointer' : 'not-allowed',
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          {isApproved ? 'Patch Approvata' : isHumanAugmented ? 'Approva Human-Augmented Patch' : 'Approvazione Atomica (git commit)'}
        </button>
      </div>
    </div>
  );
};
