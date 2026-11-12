import React, { useState, useEffect, useRef } from 'react';
import { DiffEditor, Monaco } from '@monaco-editor/react';
import type { SastFinding } from '../types.js';
import type { editor } from 'monaco-editor';

interface Props {
  readonly filePath: string;
  readonly originalCode: string;
  readonly modifiedCode: string;
  readonly findings: readonly SastFinding[];
  readonly readOnly?: boolean;
  readonly isEdited: boolean;
  readonly onOverrideChange: (filePath: string, updatedCode: string) => void;
}

function languageFromFilePath(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const filename = normalized.split('/').pop() ?? normalized;

  if (filename === 'dockerfile' || filename.startsWith('dockerfile.')) {
    return 'dockerfile';
  }

  if (filename === 'makefile' || filename.startsWith('makefile.')) {
    return 'makefile';
  }

  if (filename === '.gitignore' || filename === '.dockerignore') {
    return 'plaintext';
  }

  const extension = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';

  switch (extension) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'typescript';

    case '.tsx':
      return 'typescript';

    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';

    case '.jsx':
      return 'javascript';

    case '.py':
      return 'python';

    case '.cs':
      return 'csharp';

    case '.java':
      return 'java';

    case '.c':
    case '.h':
      return 'c';

    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
      return 'cpp';

    case '.go':
      return 'go';

    case '.rs':
      return 'rust';

    case '.php':
      return 'php';

    case '.rb':
      return 'ruby';

    case '.swift':
      return 'swift';

    case '.kt':
    case '.kts':
      return 'kotlin';

    case '.json':
    case '.jsonc':
      return 'json';

    case '.yaml':
    case '.yml':
      return 'yaml';

    case '.xml':
    case '.csproj':
    case '.props':
    case '.targets':
      return 'xml';

    case '.html':
    case '.htm':
      return 'html';

    case '.css':
      return 'css';

    case '.scss':
      return 'scss';

    case '.less':
      return 'less';

    case '.sql':
      return 'sql';

    case '.sh':
    case '.bash':
      return 'shell';

    case '.ps1':
    case '.psm1':
      return 'powershell';

    case '.md':
    case '.markdown':
      return 'markdown';

    case '.ini':
    case '.cfg':
    case '.conf':
      return 'ini';

    default:
      return 'plaintext';
  }
}


export const InteractiveDiffViewer: React.FC<Props> = ({
  filePath,
  originalCode,
  modifiedCode,
  findings,
  readOnly = false,
  isEdited,
  onOverrideChange
}) => {
  const [splitView, setSplitView] = useState(true);
  const [currentBuffer, setCurrentBuffer] = useState(modifiedCode);
  const language = languageFromFilePath(filePath);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const contentListenerRef = useRef<{ dispose: () => void; } | null>(null);
  const filePathRef = useRef(filePath);
  const onOverrideChangeRef = useRef(onOverrideChange);

  useEffect(() => {
    setCurrentBuffer(modifiedCode);
  }, [modifiedCode, filePath]);

  useEffect(() => {
    filePathRef.current = filePath;
  }, [filePath]);

  useEffect(() => {
    onOverrideChangeRef.current = onOverrideChange;
  }, [onOverrideChange]);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const modifiedEditor =
      editorRef.current.getModifiedEditor();
    const monaco = monacoRef.current;
    const model = modifiedEditor.getModel();

    if (!model) {
      return;
    }

    const lineCount = model.getLineCount();

    const markers = findings.map((finding) => {
      const startLineNumber = Math.min(
        Math.max(1, finding.startLine),
        lineCount
      );

      const requestedEndLine =
        finding.endLine > 0
          ? finding.endLine
          : finding.startLine;

      const endLineNumber = Math.min(
        Math.max(startLineNumber, requestedEndLine),
        lineCount
      );

      const endColumn =
        model.getLineMaxColumn(endLineNumber);

      const severity =
        finding.severity === 'ERROR'
          ? monaco.MarkerSeverity.Error
          : finding.severity === 'WARNING'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info;

      return {
        startLineNumber,
        startColumn: 1,
        endLineNumber,
        endColumn,
        message:
          `[${finding.severity}] ` +
          `${finding.message} (${finding.ruleId})`,
        severity
      };
    });

    monaco.editor.setModelMarkers(
      model,
      'semgrep-sast',
      markers
    );

    return () => {
      monaco.editor.setModelMarkers(
        model,
        'semgrep-sast',
        []
      );
    };
  }, [findings, currentBuffer, filePath]);


  const handleEditorMount = (editor: editor.IStandaloneDiffEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    const modifiedEditor = editor.getModifiedEditor();
    const model = modifiedEditor.getModel();
    contentListenerRef.current?.dispose();
    contentListenerRef.current = null;
    if (!model) return;
    contentListenerRef.current = model.onDidChangeContent(() => {
      const value = model.getValue();
      setCurrentBuffer(value);
      onOverrideChangeRef.current(filePathRef.current, value);

    });
  };

  useEffect(() => {
    return () => {
      contentListenerRef.current?.dispose();
    };
  }, []);


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
          <div>
            <span
              style={{
                fontSize: '0.85rem',
                fontWeight: 600
              }}
            >
              Visual Diff & Human-in-the-Loop Override
            </span>

            <span
              style={{
                marginLeft: 8,
                color: '#777',
                fontFamily: 'monospace',
                fontSize: '0.68rem'
              }}
            >
              {language}
            </span>
          </div>

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
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <DiffEditor
          height="100%"
          language={language}
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
