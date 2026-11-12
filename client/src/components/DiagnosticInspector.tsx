import React from 'react';
import { SastFinding, TestExecutionReport, OracleStatus } from '../types.js';


interface Props {
  readonly semgrepStatus: OracleStatus | null;
  readonly findings: readonly SastFinding[];
  readonly testReport?: TestExecutionReport | undefined;
}

interface OraclePresentation {
  readonly label: string;
  readonly background: string;
  readonly color: string;
}

function semgrepPresentation(
  status: OracleStatus | null,
  findingsCount: number
): OraclePresentation {
  if (status === null) {
    return {
      label: 'Non Eseguito',
      background: '#333333',
      color: '#aaaaaa'
    };
  }

  switch (status) {
    case 'PASS':
      return {
        label: 'Conforme',
        background: '#1b4728',
        color: '#4ec9b0'
      };

    case 'FAIL':
      return {
        label:
          findingsCount > 0
            ? `${findingsCount} Violazioni`
            : 'Non Conforme',
        background: '#6b201a',
        color: '#f48771'
      };

    case 'NOT_AVAILABLE':
      return {
        label: 'Non Disponibile',
        background: '#4a3d1f',
        color: '#dcdcaa'
      };

    case 'BLOCKED':
      return {
        label: 'Bloccato',
        background: '#3b3b3b',
        color: '#b5b5b5'
      };


    case 'EXECUTION_ERROR':
      return {
        label: 'Errore Oracle',
        background: '#5a1d1d',
        color: '#f48771'
      };
  }
}

function testOraclePresentation(
  status: OracleStatus | null
): OraclePresentation {
  if (status === null) {
    return {
      label: 'Non Eseguito',
      background: '#333333',
      color: '#aaaaaa'
    };
  }

  switch (status) {
    case 'PASS':
      return {
        label: '100% Pass',
        background: '#1b4728',
        color: '#4ec9b0'
      };

    case 'FAIL':
      return {
        label: 'Fallito',
        background: '#6b201a',
        color: '#f48771'
      };

    case 'NOT_AVAILABLE':
      return {
        label: 'Non Disponibile',
        background: '#4a3d1f',
        color: '#dcdcaa'
      };

    case 'BLOCKED':
      return {
        label: 'Bloccato',
        background: '#3b3b3b',
        color: '#b5b5b5'
      };


    case 'EXECUTION_ERROR':
      return {
        label: 'Errore Oracle',
        background: '#5a1d1d',
        color: '#f48771'
      };
  }
}


export const DiagnosticsInspector: React.FC<Props> = ({ findings, testReport, semgrepStatus }) => {
  const semgrep = semgrepPresentation(semgrepStatus, findings.length);
  const testOracle = testOraclePresentation(testReport?.oracleStatus ?? null);

  const hasObservedTestMetrics =
    testReport?.oracleStatus === 'PASS' ||
    testReport?.oracleStatus === 'FAIL';


  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '14px' }}>
      <div style={{ background: '#252526', padding: '14px 18px', borderRadius: '4px', border: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>
            Oracolo Statico: Semgrep SAST
          </h3>
          <span style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '10px',
            background: semgrep.background,
            color: semgrep.color,
            fontWeight: 600
          }}>
            {semgrep.label}
          </span>
        </div>

        {semgrepStatus === null ? (
          <p style={{ color: '#888', margin: 0, fontSize: '0.8rem' }}>In attesa di esecuzione dell'oracolo statico.</p>
        ) : semgrepStatus === 'PASS' ? (
          <p
            style={{
              color: '#4ec9b0',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Nessuna vulnerabilita rilevata nell'intervallo differenziale.
          </p>

        ) : semgrepStatus === 'NOT_AVAILABLE' ? (
          <p
            style={{
              color: '#dcdcaa',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Oracolo statico non disponibile per questa verifica.
          </p>
        ) : semgrepStatus === 'BLOCKED' ? (
          <p
            style={{
              color: '#b5b5b5',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Oracolo statico non eseguito perché un gate
            precedente della verifica non è stato superato.
          </p>
        ) : semgrepStatus === 'EXECUTION_ERROR' ? (
          <p
            style={{
              color: '#f48771',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Errore durante l'esecuzione dell'oracolo statico.
          </p>
        ) : findings.length === 0 ? (
          <p
            style={{
              color: '#f48771',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Verifica statica non conforme; nessun finding dettagliato disponibile.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {findings.map((f, i) => (
              <div key={`${f.path}:${f.startLine}:${f.ruleId}:${i}`} style={{ background: '#1e1e1e', padding: '8px 10px', borderRadius: '3px', borderLeft: '3px solid #f48771' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#888' }}>
                  <span>{f.path}:{f.startLine}</span>
                  <span style={{ color: '#dcdcaa' }}>{f.owaspCategory || 'OWASP / CWE'}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#eee', marginTop: '3px' }}>{f.message}</div>
                <code style={{ fontSize: '0.75rem', color: '#9cdcfe' }}>{f.ruleId}</code>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ background: '#252526', padding: '14px 18px', borderRadius: '4px', border: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>
            Oracolo Dinamico: Test Harness
          </h3>
          <span style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '10px',
            background: testOracle.background,
            color: testOracle.color,
            fontWeight: 600
          }}>
            {testOracle.label}
          </span>
        </div>

        {testReport && hasObservedTestMetrics && (
          <p
            style={{
              color: '#bbb',
              margin: '0 0 8px',
              fontSize: '0.75rem'
            }}
          >
            Exit code {testReport.exitCode ?? 'n/d'} ·
            {' '}Pass rate {(testReport.passRate * 100).toFixed(1)}% ·
            {' '}passed {testReport.passedTests}/{testReport.totalTests} ·
            {' '}failed {testReport.failedTests} ·
            {' '}errors {testReport.errorTests} ·
            {' '}skipped {testReport.skippedTests} ·
            {' '}xfailed {testReport.xfailedTests} ·
            {' '}xpassed {testReport.xpassedTests}
          </p>
        )}


        {!testReport ? (
          <p style={{ color: '#888', margin: 0, fontSize: '0.8rem' }}>In attesa di esecuzione della test suite.</p>
        ) : testReport.oracleStatus === 'PASS' ? (
          <p
            style={{
              color: '#4ec9b0',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Tutte le asserzioni superate in{' '}
            {testReport.executionDurationMs.toFixed(1)} ms.
          </p>
        ) : testReport.oracleStatus === 'NOT_AVAILABLE' ? (
          <p
            style={{
              color: '#dcdcaa',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Oracolo funzionale non disponibile per questa verifica.
          </p>
        ) : testReport.oracleStatus === 'BLOCKED' ? (
          <p
            style={{
              color: '#b5b5b5',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Test Harness non eseguito perché un gate
            precedente della verifica non è stato superato.
          </p>
        ) : testReport.oracleStatus === 'EXECUTION_ERROR' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            <p
              style={{
                color: '#f48771',
                margin: 0,
                fontSize: '0.8rem'
              }}
            >
              Errore durante l'esecuzione dell'oracolo funzionale.
            </p>

            {testReport.oracleFailureReason && (
              <p
                style={{
                  color: '#f48771',
                  margin: 0,
                  fontSize: '0.75rem'
                }}
              >
                <strong>Motivo:</strong>{' '}
                {testReport.oracleFailureReason}
              </p>
            )}

            <p
              style={{
                color: '#aaa',
                margin: 0,
                fontSize: '0.75rem'
              }}
            >
              Exit code {testReport.exitCode ?? 'n/d'}
              {testReport.timedOut
                ? ' · timeout'
                : ''}
            </p>
          </div>

        ) : testReport.failureDetails.length === 0 ? (
          <p
            style={{
              color: '#f48771',
              margin: 0,
              fontSize: '0.8rem'
            }}
          >
            Test suite non conforme; nessun dettaglio di failure disponibile.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {testReport.failureDetails.map((fail, i) => (
              <div key={`${fail.testName}:${i}`} style={{ background: '#1e1e1e', padding: '8px 10px', borderRadius: '3px', borderLeft: '3px solid #f48771' }}>
                <strong style={{ fontSize: '0.8rem', color: '#fff' }}>{fail.testName}</strong>
                <div style={{ fontSize: '0.75rem', color: '#f48771', marginTop: '2px' }}>{fail.assertionMessage}</div>
                {fail.expected !== undefined && fail.actual !== undefined && (
                  <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '4px' }}>
                    Atteso:{' '}<code>{fail.expected}</code>{' | '}Rilevato:{' '}<code>{fail.actual}</code>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
