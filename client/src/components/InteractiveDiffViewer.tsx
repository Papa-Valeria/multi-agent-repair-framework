import React, { useState, useEffect, useRef } from 'react';
import { DiffEditor, Monaco } from '@monaco-editor/react';
import { SastFinding } from '../types.js';

interface Props {
  readonly originalCode: string;
  readonly modifiedCode: string;
  readonly findings: readonly SastFinding[];
  readonly readOnly?: boolean;
  readonly onSaveOverride: (updatedCode: string) => void;
}

export const InteractiveDiffViewer: React.FC<Props> = ({
  originalCode,
  modifiedCode,
  findings,
  readOnly = false,
  onSaveOverride
}) => {
  const [splitView, setSplitView] = useState(true);
  const [currentBuffer, setCurrentBuffer] = useState(modifiedCode);
  const [isEdited, setIsEdited] = useState(false);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  useEffect(() => {
    setCurrentBuffer(modifiedCode);
    setIsEdited(false);
  }, [modifiedCode]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    const modifiedEditor = editorRef.current.getModifiedEditor();
    const monaco = monacoRef.current;

    const markers = findings.map((f) => ({
      startLineNumber: f.startLine,
      startColumn: 1,
      endLineNumber: f.endLine || f.startLine,
      endColumn: 120,
      message: `[${f.severity}] ${f.message} (${f.ruleId})`,
      severity: f.severity === 'ERROR' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning
    }));

    const model = modifiedEditor.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, 'semgrep-sast', markers);
    }
  }, [findings, currentBuffer]);

  const handleEditorMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    const modifiedEditor = editor.getModifiedEditor();
    const model = modifiedEditor.getModel();

    if (model) {
      model.onDidChangeContent(() => {
        const val = model.getValue();
        setCurrentBuffer(val);
        setIsEdited(val !== modifiedCode);
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '540px', border: '1px solid #333', background: '#1e1e1e' }}>
      <div style={{
        padding: '8px 16px',
        background: '#252526',
        color: '#ccc',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #333'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Visual Diff & Human-in-the-Loop Override</span>
          {isEdited && !readOnly && (
            <span style={{ background: '#cca700', color: '#000', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold' }}>
              Modifica In-Place Rilevata
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setSplitView(!splitView)}
            style={{
              background: '#333',
              color: '#eee',
              border: '1px solid #444',
              padding: '4px 10px',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            {splitView ? 'Vista Unificata' : 'Vista Affiancata'}
          </button>
          {isEdited && (
            <button
              onClick={() => onSaveOverride(currentBuffer)}
              style={{
                background: '#0e639c',
                color: '#fff',
                border: 'none',
                padding: '4px 12px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: 600
              }}
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
          modified={currentBuffer}
          options={{
            renderSideBySide: splitView,
            readOnly,
            glyphMargin: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true
          }}
          onMount={handleEditorMount}
        />
      </div>
    </div>
  );
};
