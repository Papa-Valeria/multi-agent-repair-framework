import React, { useState, useEffect } from 'react';
import { ActionToolbar } from './components/ActionToolbar.js';
import { InteractiveDiffViewer } from './components/InteractiveDiffViewer.js';
import { SessionHeader } from './components/SessionHeader.js';
import { TelemetryHUD } from './components/TelemetryHUD.js';
import { WorkbenchSessionState } from './types.js';
import { DiagnosticsInspector } from './components/DiagnosticInspector.js';
import { AnalyticsView } from './components/AnalyticsView.js';
import type { ExperimentCategory, StoredRun } from '../../src/types/analytics.js';
import { applyHunksToContent, parseFileDiffs } from '../../src/git/UnifiedDiff.js';
import { BarChart3, Code2 } from 'lucide-react';

const API_BASE = 'http://localhost:3000/api';

interface ModelPreset {
  readonly identifier: string;
  readonly label: string;
  readonly apiBaseUrl: string;
}

const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    identifier: 'qwen2.5-coder:7b',
    label: 'Qwen2.5-Coder 7B · Ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1'
  },
  {
    identifier: 'deepseek-coder:6.7b',
    label: 'DeepSeek-Coder 6.7B · Ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1'
  },
  {
    identifier: 'codellama:7b',
    label: 'CodeLlama 7B · Ollama',
    apiBaseUrl: 'http://127.0.0.1:11434/v1'
  }
];

interface BenchmarkPreset {
  readonly id: string;
  readonly label: string;
  readonly issueSpec: string;
  readonly targetFile: string;
  readonly testFile: string;
}

const BENCHMARK_PRESETS: readonly BenchmarkPreset[] = [
  {
    id: 'BENCH-SEC-01',
    label: 'CWE-89: SQL Injection (SecRepair)',
    issueSpec: 'Fix SQL injection vulnerability in authenticate() by parameterizing the query and ensure authenticate() returns True on success.',
    targetFile: 'service.py',
    testFile: 'test_service.py'
  },
  {
    id: 'BENCH-SEC-02',
    label: 'CWE-22: Path Traversal (SecRepair)',
    issueSpec: 'Fix Path Traversal in get_file(). Normalize the resolved path. If outside base_dir, raise ValueError. Ensure valid files are returned.',
    targetFile: 'storage.py',
    testFile: 'test_storage.py'
  },
  {
    id: 'BENCH-SEC-03',
    label: 'CWE-78: OS Command Injection (SecRepair)',
    issueSpec: 'Fix OS Command Injection in check_process_status(). Remove shell=True, pass arguments as a list to subprocess.run, and ensure it returns a boolean.',
    targetFile: 'sys_proc.py',
    testFile: 'test_sys_proc.py'
  },
  {
    id: 'BENCH-SEC-04',
    label: 'CWE-502: Insecure Deserialization (SecRepair)',
    issueSpec: 'Fix Insecure Deserialization in load_payload(). Replace unsafe pickle with json.loads and raise ValueError if data cannot be parsed.',
    targetFile: 'serializer.py',
    testFile: 'test_serializer.py'
  },
  {
    id: 'BENCH-LOGIC-01',
    label: 'CWE-193: Off-by-one Pagination (BugsInPy)',
    issueSpec: 'Fix off-by-one calculation in paginate_items(). Page index is 1-based. Page 1 of size 2 must return items [0..2], page 2 items [2..4]. Return empty list if page is out of bounds.',
    targetFile: 'pagination.py',
    testFile: 'test_pagination.py'
  }
];

/**
 * Applicatore deterministico di Unified Diff in memoria.
 * Ricostruisce il sorgente Python modificato per consentire a Monaco Editor
 * di confrontare codice vs codice invece di mostrare intestazioni raw Git.
 */
function applyUnifiedDiffToSource(original: string, diffText: string, targetFile: string): string {
  const fileDiffs = parseFileDiffs(diffText);
  const match = fileDiffs.find((candidate) => candidate.file === targetFile) ?? fileDiffs[0];
  if (!match) return original;
  // Patch non applicabile: nessuna modifica visualizzata, come nel backend.
  return applyHunksToContent(original, match.hunks) ?? original;
}

/**
 * Sintetizza un delta Unified Diff formale da codice originale e modificato (RF-09).
 */
function createFullReplacementDiff(filename: string, original: string, modified: string): string {
  const origLines = original.replace(/\r\n/g, '\n').split('\n');
  const modLines = modified.replace(/\r\n/g, '\n').split('\n');

  return [
    `diff --git a/${filename} b/${filename}`,
    `--- a/${filename}`,
    `+++ b/${filename}`,
    `@@ -1,${origLines.length} +1,${modLines.length} @@`,
    ...origLines.map((l) => `-${l}`),
    ...modLines.map((l) => `+${l}`),
    ''
  ].join('\n');
}

export const App: React.FC = () => {
  const [repoPath, setRepoPath] = useState(
    'C:\\Users\\v.papa\\OneDrive - Avanade\\Personale\\Tesi\\target-repositories\\sandbox_test'
  );
  const [taskId, setTaskId] = useState('task-001');
  const [issueSpec, setIssueSpec] = useState(
    'Fix SQL injection vulnerability in authenticate() and ensure test suite passes.'
  );
  const [targetFile, setTargetFile] = useState('service.py');
  const [testFile, setTestFile] = useState('test_service.py');
  const [taskCategory, setTaskCategory] = useState<ExperimentCategory>('REPAIR');
  const [modelIdentifier, setModelIdentifier] = useState('qwen2.5-coder:7b');
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [modelSeed, setModelSeed] = useState(42);
  const [modelTemperature, setModelTemperature] = useState(0);
  const [modelTopP, setModelTopP] = useState(1);

  const [session, setSession] = useState<WorkbenchSessionState | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string>('IDLE');
  const [selectedIteration, setSelectedIteration] = useState<number>(1);
  const [originalCode, setOriginalCode] = useState<string>('');
  const [modifiedCode, setModifiedCode] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [sseLogs, setSseLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'WORKSPACE' | 'ANALYTICS'>('WORKSPACE');
  const [replayRunId, setReplayRunId] = useState<string | null>(null);

  // Sottoscrizione Server-Sent Events (SSE) (Livello 1)
  useEffect(() => {
    if (!taskId || !isRunning) return;

    const sse = new EventSource(`${API_BASE}/tasks/${taskId}/stream`);

    sse.addEventListener('PHASE_TRANSITION', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setCurrentPhase(`Iter #${data.iteration}: ${data.state}`);
      setSseLogs((prev) => [...prev, `[FSM] Iterazione #${data.iteration} -> Stato: ${data.state}`]);
    });

    sse.addEventListener('ORACLE_PROGRESS', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setSseLogs((prev) => [
        ...prev,
        `[Oracle] ${data.tool}: completato (${data.findingsCount} anomalie/fallimenti)`
      ]);
    });

    sse.addEventListener('ITERATION_COMPLETE', (e: MessageEvent) => {
      const state: WorkbenchSessionState = JSON.parse(e.data);
      setSession(state);
      setSelectedIteration(state.currentIteration);
      setIsRunning(false);
      setCurrentPhase(state.status);
      setStatusMessage({
        text: `Sessione conclusa con stato: ${state.status} (Iterazione ${state.currentIteration}/${state.maxIterations})`,
        isError: state.status === 'FAILED'
      });
    });

    sse.onerror = () => {
      sse.close();
    };

    return () => sse.close();
  }, [taskId, isRunning]);

  const loadOriginalCode = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/files/read?repoPath=${encodeURIComponent(repoPath)}&filePath=${targetFile}`
      );
      if (!res.ok) throw new Error('File non trovato');
      const data = await res.json();
      setOriginalCode(data.content || '');
    } catch {
      setOriginalCode('# Impossibile leggere il file target originale.');
    }
  };

  useEffect(() => {
    if (!replayRunId) void loadOriginalCode();
  }, [repoPath, targetFile, replayRunId]);

  // Aggiorna la vista differenziale: applica il diff sul codice reale
  useEffect(() => {
    if (!session || session.iterations.length === 0) {
      setModifiedCode(originalCode);
      return;
    }

    const iterIndex = Math.max(0, Math.min(selectedIteration - 1, session.iterations.length - 1));
    const iterRecord = session.iterations[iterIndex];

    if (iterRecord?.patchDiff && iterRecord.isApplicable) {
      const patched = applyUnifiedDiffToSource(originalCode, iterRecord.patchDiff, targetFile);
      setModifiedCode(patched);
    } else {
      setModifiedCode(originalCode);
    }
  }, [session, selectedIteration, originalCode, targetFile]);

  const handleApplyPreset = (presetId: string) => {
    const found = BENCHMARK_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setTaskId(found.id);
    setIssueSpec(found.issueSpec);
    setTargetFile(found.targetFile);
    setTestFile(found.testFile);
    setTaskCategory('REPAIR');
    setSession(null);
    setReplayRunId(null);
    setSelectedIteration(1);
    setSseLogs([]);
    setStatusMessage(null);
  };

  const handleSelectModel = (identifier: string) => {
    const profile = MODEL_PRESETS.find((candidate) => candidate.identifier === identifier);
    if (!profile) return;
    setModelIdentifier(profile.identifier);
    setApiBaseUrl(profile.apiBaseUrl);
  };

  const handleExecute = async (isBaseline: boolean) => {
    setReplayRunId(null);
    setIsRunning(true);
    setStatusMessage(null);
    setSseLogs([`[Client] Avvio task ${taskId} (${isBaseline ? 'Baseline Single-Agent' : 'Multi-Agent Loop'})...`]);
    await loadOriginalCode();

    const payload = {
      repoPath,
      issueSpec,
      targetFiles: [targetFile],
      testFiles: [testFile],
      category: taskCategory,
      modelConfig: {
        apiBaseUrl,
        modelIdentifier,
        seed: modelSeed,
        temperature: modelTemperature,
        topP: modelTopP
      },
      executionMode: isBaseline ? 'BASELINE' : 'MULTI_AGENT'
    };

    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const errorMessage = typeof data === 'object' && data !== null && 'error' in data
          ? String(data.error)
          : `Richiesta rifiutata (${res.status}).`;
        throw new Error(errorMessage);
      }
      const sessionData = data as WorkbenchSessionState;
      setSession(sessionData);
      setSelectedIteration(sessionData.currentIteration);
    } catch (err: unknown) {
      setStatusMessage({ text: `Errore durante l'invio del task: ${(err as Error).message}`, isError: true });
    } finally {
      setIsRunning(false);
    }
  };

  const handleReplay = (run: StoredRun) => {
    const sourceFile = run.session.targetFiles[0];
    setReplayRunId(run.metadata.runId);
    setSession(run.session);
    setTaskId(run.session.taskId);
    setIssueSpec(run.session.issueSpec);
    setApiBaseUrl(run.modelConfig.baseUrl);
    setModelIdentifier(run.modelConfig.modelName);
    setModelSeed(run.modelConfig.seed);
    setModelTemperature(run.modelConfig.temperature);
    setModelTopP(run.modelConfig.topP);
    if (sourceFile) {
      setTargetFile(sourceFile);
      setOriginalCode(run.targetSources[sourceFile] ?? '');
    }
    setSelectedIteration(Math.max(1, run.session.currentIteration));
    setCurrentPhase(`Replay ${run.metadata.mode}`);
    setActiveTab('WORKSPACE');
    setStatusMessage({ text: `Replay run ${run.metadata.runId.slice(0, 8)} · ${run.metadata.timestamp}`, isError: false });
  };

  const handleApprove = async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approvazione non riuscita.');
      setSession((current) => current ? {
        ...current,
        status: 'APPROVED',
        approvalCommitHash: data.commitHash
      } : current);
      setStatusMessage({ text: `Patch formalizzata sul branch! Commit: ${data.commitHash}`, isError: false });
    } catch (err: unknown) {
      setStatusMessage({ text: `Errore approvazione: ${(err as Error).message}`, isError: true });
    }
  };

  const handleReject = async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${taskId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rollback non riuscito.');
      setSession((current) => current ? { ...current, status: 'REJECTED' } : current);
      setStatusMessage({ text: 'Modifiche scartate: repository ripristinato allo stato clean HEAD.', isError: false });
      await loadOriginalCode();
      setModifiedCode(originalCode);
    } catch (err: unknown) {
      setStatusMessage({ text: `Errore durante il rollback: ${(err as Error).message}`, isError: true });
    }
  };

  const handleHumanOverride = async (updatedSource: string) => {
    try {
      const overrideDiff = createFullReplacementDiff(targetFile, originalCode, updatedSource);
      const res = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath, overrideDiff })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Human Override non approvato.');
      setSession((current) => current ? {
        ...current,
        status: 'APPROVED',
        approvalCommitHash: data.commitHash,
        isHumanAugmented: true
      } : current);
      setStatusMessage({
        text: `Human-Augmented Patch applicata e registrata con commit ${data.commitHash}.`,
        isError: false
      });
    } catch (err: unknown) {
      setStatusMessage({ text: `Errore salvataggio override: ${(err as Error).message}`, isError: true });
    }
  };

  const currentIterData = session?.iterations[selectedIteration - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#181818', color: '#ccc' }}>
      {activeTab === 'WORKSPACE' && <SessionHeader
        taskId={taskId}
        status={session?.status ?? 'INATTIVO'}
        targetFiles={session?.targetFiles ?? [targetFile]}
        currentPhase={currentPhase}
        iterationsCount={session?.iterations.length ?? 0}
        selectedIteration={selectedIteration}
        onSelectIteration={setSelectedIteration}
      />}

      <nav aria-label="Navigazione principale" style={{ display: 'flex', gap: 6, padding: '8px 24px', background: '#202020', borderBottom: '1px solid #333' }}>
        <button onClick={() => setActiveTab('WORKSPACE')} aria-pressed={activeTab === 'WORKSPACE'} style={tabButtonStyle(activeTab === 'WORKSPACE')}><Code2 size={15} /> Workspace</button>
        <button onClick={() => setActiveTab('ANALYTICS')} aria-pressed={activeTab === 'ANALYTICS'} style={tabButtonStyle(activeTab === 'ANALYTICS')}><BarChart3 size={15} /> Research Analytics</button>
      </nav>

      <main style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {activeTab === 'ANALYTICS' ? <AnalyticsView onReplay={handleReplay} /> : <>
        {/* Banner notifiche inline */}
        {statusMessage && (
          <div
            style={{
              padding: '10px 16px',
              borderRadius: '4px',
              background: statusMessage.isError ? '#5a1d1d' : '#1e4620',
              color: statusMessage.isError ? '#f48771' : '#4ec9b0',
              fontSize: '0.85rem',
              fontWeight: 500,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Pannello Configurazione & Ingestione (RF-01) */}
        <section style={{ background: '#252526', padding: '16px 20px', borderRadius: '4px', border: '1px solid #333' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '0.95rem', color: '#fff', fontWeight: 600 }}>
              Configurazione Task & Ingestione Contesto (RF-01)
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.75rem', color: '#888' }}>Preset Benchmark:</span>
              <select
                onChange={(e) => handleApplyPreset(e.target.value)}
                defaultValue=""
                style={{
                  background: '#1e1e1e',
                  color: '#fff',
                  border: '1px solid #444',
                  padding: '4px 8px',
                  borderRadius: '3px',
                  fontSize: '0.8rem'
                }}
              >
                <option value="" disabled>Carica Benchmark Predefinito...</option>
                {BENCHMARK_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Task ID</label>
              <input
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Specifiche del Difetto (issueSpec)</label>
              <input
                value={issueSpec}
                onChange={(e) => setIssueSpec(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Target File</label>
              <input
                value={targetFile}
                onChange={(e) => setTargetFile(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Test File</label>
              <input
                value={testFile}
                onChange={(e) => setTestFile(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Categoria esperimento</label>
              <select
                value={taskCategory}
                onChange={(event) => setTaskCategory(event.target.value as ExperimentCategory)}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              >
                <option value="REPAIR">REPAIR</option>
                <option value="CREATE">CREATE</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Path Repository Target (Sandbox Locale)</label>
            <input
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr repeat(3, minmax(110px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label htmlFor="model-identifier" style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Modello locale</label>
              <select
                id="model-identifier"
                value={modelIdentifier}
                onChange={(event) => handleSelectModel(event.target.value)}
                disabled={isRunning || !!replayRunId}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              >
                {MODEL_PRESETS.map((profile) => (
                  <option key={profile.identifier} value={profile.identifier}>{profile.label}</option>
                ))}
              </select>
              <span style={{ fontSize: '0.7rem', color: '#777' }}>Tag: {modelIdentifier}</span>
            </div>
            <div>
              <label htmlFor="model-api-base-url" style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>Endpoint OpenAI-compatible locale</label>
              <input
                id="model-api-base-url"
                type="url"
                value={apiBaseUrl}
                onChange={(event) => setApiBaseUrl(event.target.value)}
                disabled={isRunning || !!replayRunId}
                style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
              />
            </div>
            <NumberSetting label="Seed" value={modelSeed} min={0} max={2147483647} step={1} disabled={isRunning || !!replayRunId} onChange={setModelSeed} />
            <NumberSetting label="Temperature" value={modelTemperature} min={0} max={2} step={0.05} disabled={isRunning || !!replayRunId} onChange={setModelTemperature} />
            <NumberSetting label="Top-p" value={modelTopP} min={0.01} max={1} step={0.05} disabled={isRunning || !!replayRunId} onChange={setModelTopP} />
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleExecute(true)}
              disabled={isRunning}
              style={{
                background: '#333',
                color: '#eee',
                border: '1px solid #555',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}
            >
              Lancia Baseline Single-Agent (RF-09)
            </button>
            <button
              onClick={() => handleExecute(false)}
              disabled={isRunning}
              style={{
                background: '#0e639c',
                color: '#fff',
                border: 'none',
                padding: '8px 18px',
                borderRadius: '4px',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}
            >
              {isRunning ? 'Esecuzione FSM in corso...' : 'Avvia Multi-Agent Self-Refinement (RF-07)'}
            </button>
          </div>
        </section>

        {/* Telemetria Computazionale (RNF-02, RNF-05) */}
        {session && (
          <TelemetryHUD
            telemetry={currentIterData?.telemetry ?? session.cumulativeTelemetry}
            overallTelemetry={session.cumulativeTelemetry}
            currentIteration={selectedIteration}
            maxIterations={session.maxIterations}
          />
        )}

        {/* Visualizzatore Differenziale Monaco Side-by-Side (RF-08, RF-09) */}
        <InteractiveDiffViewer
          originalCode={originalCode}
          modifiedCode={modifiedCode}
          findings={currentIterData?.verification?.sastFindings ?? []}
          readOnly={!!replayRunId}
          onSaveOverride={handleHumanOverride}
        />

        {/* Rilievi Statici Semgrep e Riscontri Test Pytest (Livello 3) */}
        <DiagnosticsInspector
          findings={currentIterData?.verification?.sastFindings ?? []}
          testReport={currentIterData?.verification?.testReport}
        />

        {/* Event Logs Streaming SSE */}
        {sseLogs.length > 0 && (
          <details style={{ background: '#212121', border: '1px solid #333', borderRadius: '4px', padding: '10px 14px' }}>
            <summary style={{ fontSize: '0.8rem', color: '#888', cursor: 'pointer', fontWeight: 600 }}>
              Log Streaming SSE in tempo reale ({sseLogs.length} eventi)
            </summary>
            <div style={{ maxHeight: '100px', overflowY: 'auto', marginTop: '8px', fontSize: '0.75rem', fontFamily: 'monospace', color: '#9cdcfe' }}>
              {sseLogs.map((log, idx) => (
                <div key={idx}>{log}</div>
              ))}
            </div>
          </details>
        )}

        {/* Toolbar Azioni Decisioni Human-in-the-Loop (RF-09) */}
        <ActionToolbar
          isConverged={!replayRunId && session?.status === 'CONVERGED'}
          isHumanAugmented={!replayRunId && session?.status === 'CONVERGED' && session.isHumanAugmented}
          isApproved={session?.status === 'APPROVED'}
          canReject={!replayRunId && !!session && session.status !== 'APPROVED' && session.status !== 'REJECTED'}
          onApprove={handleApprove}
          onReject={handleReject}
        />
        </>}
      </main>
    </div>
  );
};

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <div>
      <label style={{ fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px' }}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box', background: '#1e1e1e', border: '1px solid #444', color: '#fff', borderRadius: '3px' }}
      />
    </div>
  );
}

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    padding: '7px 11px', border: `1px solid ${active ? '#4a9fd2' : '#444'}`,
    borderRadius: 3, color: active ? '#d9effb' : '#aaa',
    background: active ? '#183346' : 'transparent', cursor: 'pointer'
  };
}
