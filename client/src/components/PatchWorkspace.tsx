import React from 'react';
import { InteractiveDiffViewer } from './InteractiveDiffViewer.js';
import type { SastFinding, WorkspaceFile } from '../types.js';
import {
  canonicalizeWorkspacePath,
  workspacePathsEqual
} from '../utils/workspacePath.js';

interface PatchWorkspaceProps {
  readonly targetFile: string;
  readonly files: readonly WorkspaceFile[];
  readonly selectedFilePath: string;
  readonly fallbackOriginalCode: string;
  readonly fallbackModifiedCode: string;
  readonly selectedDraft: string | undefined;
  readonly dirtyFilePaths: ReadonlySet<string>;
  readonly findings: readonly SastFinding[];
  readonly readOnly: boolean;
  readonly isSelectedFileEdited: boolean;
  readonly onSelectFile: (filePath: string) => void;
  readonly onOverrideChange: (filePath: string, updatedSource: string) => void;
}

export const PatchWorkspace: React.FC<PatchWorkspaceProps> = ({
  targetFile,
  files,
  selectedFilePath,
  fallbackOriginalCode,
  fallbackModifiedCode,
  selectedDraft,
  dirtyFilePaths,
  findings,
  readOnly,
  isSelectedFileEdited,
  onSelectFile,
  onOverrideChange
}) => {
  const hasWorkspaceFiles = files.length > 0;
  const canonicalSelectedPath = canonicalizeWorkspacePath(selectedFilePath || targetFile);
  const canonicalDirtyFilePaths = new Set(Array.from(dirtyFilePaths, canonicalizeWorkspacePath));
  const selectedFile = files.find((file) => workspacePathsEqual(file.path, canonicalSelectedPath));
  const selectedStatus = selectedFile?.status;
  const selectedFileReadOnly = readOnly || selectedFile?.status === 'UNCHANGED';
  const displayedFilePath =
    hasWorkspaceFiles
      ? selectedFile?.path ?? ''
      : selectedFilePath || targetFile;

  const displayedOriginalCode =
    hasWorkspaceFiles
      ? selectedFile?.originalContent ?? ''
      : fallbackOriginalCode;

  const displayedModifiedCode =
    hasWorkspaceFiles
      ? selectedFile
        ? selectedDraft ??
        selectedFile.modifiedContent
        : ''
      : fallbackModifiedCode;

  const selectedFindings = findings.filter((finding) => workspacePathsEqual(
    finding.path,
    canonicalSelectedPath
  )
  );

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns:
          files.length > 0
            ? '260px minmax(0, 1fr)'
            : '1fr',
        minHeight: 520,
        background: '#1e1e1e',
        border: '1px solid #333',
        borderRadius: 4,
        overflow: 'hidden'
      }}
    >
      {files.length > 0 && (
        <aside
          style={{
            background: '#202020',
            borderRight: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid #333',
              color: '#aaa',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            File del manifest ({files.length})
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: 6,
              gap: 3,
              overflowY: 'auto'
            }}
          >
            {files.map((file) => {
              const canonicalFilePath = canonicalizeWorkspacePath(file.path);
              const selected = canonicalFilePath === canonicalSelectedPath;
              const dirty = canonicalDirtyFilePaths.has(canonicalFilePath);
              const statusColor = workspaceFileStatusColor(file.status);

              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() =>
                    onSelectFile(file.path)
                  }
                  style={{
                    width: '100%',
                    border: selected
                      ? '1px solid #4a9fd2'
                      : '1px solid transparent',
                    borderRadius: 3,
                    background: selected
                      ? '#183346'
                      : 'transparent',
                    color: '#ddd',
                    cursor: 'pointer',
                    padding: '8px 9px',
                    display: 'grid',
                    gridTemplateColumns:
                      '20px minmax(0, 1fr)',
                    gap: 7,
                    alignItems: 'center',
                    textAlign: 'left'
                  }}
                >
                  <span
                    style={{
                      color: statusColor,
                      fontFamily: 'monospace',
                      fontWeight: 800,
                      fontSize: '0.78rem'
                    }}
                  >
                    {file.status === 'NEW'
                      ? '+'
                      : file.status === 'MODIFIED'
                        ? 'M'
                        : '·'}
                  </span>

                  <span
                    style={{
                      display: 'block',
                      minWidth: 0
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        minWidth: 0
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily: 'monospace',
                          fontSize: '0.74rem'
                        }}
                        title={file.path}
                      >
                        {file.path}
                      </span>

                      {dirty && (
                        <span
                          aria-label="Human Override pendente"
                          title="Human Override pendente"
                          style={{
                            flexShrink: 0,
                            color: '#cca700',
                            fontSize: '0.72rem',
                            fontWeight: 800
                          }}
                        >
                          ●
                        </span>
                      )}
                    </span>

                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        color: dirty
                          ? '#cca700'
                          : statusColor,
                        fontSize: '0.62rem',
                        fontWeight: 700
                      }}
                    >
                      {file.role} · {file.status}
                      {dirty
                        ? ' · HUMAN OVERRIDE'
                        : ''}
                    </span>
                  </span>


                </button>
              );
            })}
          </div>
        </aside>
      )}

      <div
        style={{
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <header
          style={{
            minHeight: 42,
            padding: '8px 12px',
            background: '#252526',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: '#eee',
                fontFamily: 'monospace',
                fontSize: '0.78rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
              title={displayedFilePath}
            >
              {displayedFilePath}
            </div>

            <div
              style={{
                marginTop: 2,
                color: '#777',
                fontSize: '0.65rem'
              }}
            >
              {selectedFile
                ? `${selectedFile.role} · ${selectedFile.status}`
                : 'Target principale dell esperimento'}

            </div>
          </div>

          {selectedStatus && (
            <span
              style={{
                flexShrink: 0,
                padding: '3px 7px',
                borderRadius: 3,
                border: `1px solid ${workspaceFileStatusColor(
                  selectedStatus
                )}`,
                color: workspaceFileStatusColor(
                  selectedStatus
                ),
                fontSize: '0.65rem',
                fontWeight: 700
              }}
            >
              {selectedStatus}
            </span>
          )}
        </header>

        <div
          style={{
            flex: 1,
            minHeight: 0
          }}
        >
          {hasWorkspaceFiles && !selectedFile ? (
            <div
              style={{
                padding: 16,
                color: '#f48771',
                fontSize: '0.8rem'
              }}
            >
              File selezionato non presente nel workspace.
            </div>
          ) : (
            <InteractiveDiffViewer
              filePath={displayedFilePath}
              originalCode={displayedOriginalCode}
              modifiedCode={displayedModifiedCode}
              findings={selectedFindings}
              readOnly={selectedFileReadOnly}
              isEdited={isSelectedFileEdited}
              onOverrideChange={onOverrideChange}
            />
          )}
        </div>
      </div>
    </section>
  );
};

function workspaceFileStatusColor(
  status: WorkspaceFile['status']
): string {
  switch (status) {
    case 'NEW':
      return '#4ec9b0';

    case 'MODIFIED':
      return '#dcdcaa';

    case 'UNCHANGED':
      return '#777';
  }
}


