import React, { useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { SastFinding } from '../types/domain.js';


interface Props {
  readonly originalCode: string;
  readonly modifiedCode: string;
  readonly findings: readonly SastFinding[];
  readonly onOverrideSave?: (newModifiedCode: string) => void;
}

export const InteractiveDiffViewer: React.FC<Props> = ({
  originalCode,
  modifiedCode,
  findings,
  onOverrideSave
}) => {
  const [currentModified, setCurrentModified] = useState(modifiedCode);
  const [splitView, setSplitView] = useState(true);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '600px', border: '1px solid #333' }}>
      <div style={{ padding: '8px', background: '#1e1e1e', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
        <span><strong>Visual Diff & Human Override</strong></span>
        <div>
          <button onClick={() => setSplitView(!splitView)} style={{ marginRight: '10px' }}>
            {splitView ? 'Vista Unificata' : 'Vista Affiancata'}
          </button>
          {onOverrideSave && (
            <button
              onClick={() => onOverrideSave(currentModified)}
              style={{ background: '#0e639c', color: '#fff', border: 'none', padding: '4px 8px', cursor: 'pointer' }}
            >
              Ricalcola Patch (Human Override)
            </button>
          )}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <DiffEditor
          height="100%"
          language="python"
          theme="vs-dark"
          original={originalCode}
          modified={currentModified}
          options={{
            renderSideBySide: splitView,
            readOnly: false, // Abilita Human Override (RF-08)
            minimap: { enabled: false },
            scrollBeyondLastLine: false
          }}
          onMount={(editor) => {
            const modModel = editor.getModifiedEditor().getModel();
            if (modModel) {
              modModel.onDidChangeContent(() => {
                setCurrentModified(modModel.getValue());
              });
            }
          }}
        />
      </div>
      {findings.length > 0 && (
        <div style={{ background: '#252526', padding: '10px', color: '#f48771', borderTop: '1px solid #333' }}>
          <strong>Semgrep SAST Rilievi nel Diff ({findings.length}):</strong>
          <ul style={{ margin: '5px 0 0 20px', padding: 0 }}>
            {findings.map((f, i) => (
              <li key={i}>
                [{f.severity}] Riga {f.startLine}: {f.message} (<strong>{f.ruleId}</strong>)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
