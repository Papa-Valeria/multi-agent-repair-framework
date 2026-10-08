import React from 'react';
import { SastFinding, TestExecutionReport } from '../types.js';


interface Props {
  readonly findings: readonly SastFinding[];
  readonly testReport?: TestExecutionReport | undefined;
}

export const DiagnosticsInspector: React.FC<Props> = ({ findings, testReport }) => {
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
            background: findings.length === 0 ? '#1b4728' : '#6b201a',
            color: findings.length === 0 ? '#4ec9b0' : '#f48771',
            fontWeight: 600
          }}>
            {findings.length === 0 ? 'Conforme' : `${findings.length} Violazioni`}
          </span>
        </div>

        {findings.length === 0 ? (
          <p style={{ color: '#888', margin: 0, fontSize: '0.8rem' }}>Nessuna vulnerabilità rilevata nell'intervallo differenziale.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {findings.map((f, i) => (
              <div key={i} style={{ background: '#1e1e1e', padding: '8px 10px', borderRadius: '3px', borderLeft: '3px solid #f48771' }}>
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
            background: testReport?.suitePassed ? '#1b4728' : '#6b201a',
            color: testReport?.suitePassed ? '#4ec9b0' : '#f48771',
            fontWeight: 600
          }}>
            {testReport ? (testReport.timedOut ? 'Timeout' : testReport.oracleFailed ? 'Oracle fallito' : testReport.suitePassed ? '100% Pass' : 'Fallito') : 'Non Eseguito'}
          </span>
        </div>

        {testReport && (
          <p style={{ color: '#bbb', margin: '0 0 8px', fontSize: '0.75rem' }}>
            Exit code {testReport.exitCode ?? 'n/d'} · Pass rate {(testReport.passRate * 100).toFixed(1)}% ·
            {' '}passed {testReport.passedTests}/{testReport.totalTests} · failed {testReport.failedTests} ·
            {' '}errors {testReport.errorTests} · skipped {testReport.skippedTests} · xfailed {testReport.xfailedTests}
          </p>
        )}

        {!testReport ? (
          <p style={{ color: '#888', margin: 0, fontSize: '0.8rem' }}>In attesa di esecuzione della test suite.</p>
        ) : testReport.suitePassed ? (
          <p style={{ color: '#4ec9b0', margin: 0, fontSize: '0.8rem' }}>
            Tutte le asserzioni superate in {testReport.executionDurationMs.toFixed(1)} ms.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
            {testReport.failureDetails.map((fail, i) => (
              <div key={i} style={{ background: '#1e1e1e', padding: '8px 10px', borderRadius: '3px', borderLeft: '3px solid #f48771' }}>
                <strong style={{ fontSize: '0.8rem', color: '#fff' }}>{fail.testName}</strong>
                <div style={{ fontSize: '0.75rem', color: '#f48771', marginTop: '2px' }}>{fail.assertionMessage}</div>
                {fail.expected && fail.actual && (
                  <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '4px' }}>
                    Atteso: <code>{fail.expected}</code> | Rilevato: <code>{fail.actual}</code>
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
