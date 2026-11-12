import React from 'react';
import type { WorkbenchSessionState } from '../../../src/types/domain.js';

type FinalizationStatus = WorkbenchSessionState['finalizationStatus'];

interface Props {
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly finalizationStatus: FinalizationStatus;
  readonly hasPendingHumanOverride: boolean;
  readonly isHumanAugmented: boolean;
  readonly onApprove: () => Promise<void>;
  readonly onReject: () => Promise<void>;
  readonly isFinalizing: boolean;
}

export const ActionToolbar: React.FC<Props> = ({
  canApprove,
  canReject,
  finalizationStatus,
  hasPendingHumanOverride,
  isHumanAugmented,
  onApprove,
  onReject,
  isFinalizing
}) => {
  const isFinalized = finalizationStatus !== 'NOT_FINALIZED';
  const rejectDisabled = isFinalizing || isFinalized || !canReject;
  const approveDisabled = isFinalizing || isFinalized || !canApprove;

  const handleApproveClick =
    async (): Promise<void> => {
      if (approveDisabled) {
        return;
      }

      await onApprove();
    };

  const handleRejectClick =
    async (): Promise<void> => {
      if (rejectDisabled) {
        return;
      }

      await onReject();
    };

  const candidateLabel =
    finalizationStatus === 'APPROVED'
      ? isHumanAugmented
        ? 'Sessione Human-Augmented'
        : 'Candidata autonoma approvata'
      : finalizationStatus === 'REJECTED'
        ? 'Sessione scartata'
        : hasPendingHumanOverride
          ? 'Human Override pendente'
          : 'Candidata autonoma';

  const candidateColor =
    finalizationStatus === 'REJECTED'
      ? '#f48771'
      : hasPendingHumanOverride &&
        finalizationStatus === 'NOT_FINALIZED'
        ? '#dcdcaa'
        : isHumanAugmented &&
          finalizationStatus === 'APPROVED'
          ? '#c586c0'
          : '#4ec9b0';

  const approveLabel =
    isFinalizing
      ? hasPendingHumanOverride
        ? 'Finalizzazione Human Override...'
        : 'Finalizzazione candidata autonoma...'
      : finalizationStatus === 'APPROVED'
        ? isHumanAugmented
          ? 'Human-Augmented approvata'
          : 'Candidata autonoma approvata'
        : finalizationStatus === 'REJECTED'
          ? 'Sessione scartata'
          : hasPendingHumanOverride
            ? 'Verifica e approva Human Override'
            : 'Approva candidata autonoma';

  const rejectLabel =
    isFinalizing
      ? 'Finalizzazione in corso...'
      : finalizationStatus === 'REJECTED'
        ? 'Sessione scartata'
        : finalizationStatus === 'APPROVED'
          ? isHumanAugmented
            ? 'Human-Augmented approvata'
            : 'Candidata autonoma approvata'
          : hasPendingHumanOverride
            ? 'Scarta override e ripristina'
            : 'Scarta candidata e ripristina';


  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '14px 0 0 0',
      borderTop: '1px solid #333',
      marginTop: '16px',
      gap: '16px',
      flexWrap: 'wrap'
    }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          minWidth: 0
        }}
      >
        <div
          style={{
            fontSize: '0.78rem',
            color: candidateColor,
            fontWeight: 700
          }}
        >
          {candidateLabel}
        </div>

        <div
          style={{
            fontSize: '0.8rem',
            color: '#888'
          }}
        >
          Presidio Human-in-the-Loop (HITL): nessuna modifica
          fluisce su <code>main</code> senza firma esplicita dello
          sviluppatore.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleRejectClick}
          disabled={rejectDisabled}
          style={{
            background: '#a1260d',
            color: '#fff',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '4px',
            cursor: rejectDisabled ? 'not-allowed' : 'pointer',
            opacity: rejectDisabled ? 0.5 : 1,
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          {rejectLabel}
        </button>
        <button
          type="button"
          onClick={handleApproveClick}
          disabled={approveDisabled}
          style={{
            background: !approveDisabled ? '#2e7d32' : '#223824',
            color: !approveDisabled ? '#fff' : '#666',
            border: 'none',
            padding: '8px 18px',
            borderRadius: '4px',
            cursor: !approveDisabled ? 'pointer' : 'not-allowed',
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          {approveLabel}
        </button>
      </div>
    </div>
  );
};
