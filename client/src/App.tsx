import { BarChart3, Code2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { applyHunksToContent, createFullReplacementDiff, parseFileDiffs } from '../../src/git/UnifiedDiff.js';
import type { ExperimentCategory, StoredRun } from '../../src/types/analytics.js';
import type { FunctionalTestOracleConfig } from '../../src/types/domain.js';
import { ActionToolbar } from './components/ActionToolbar.js';
import { DiagnosticsInspector } from './components/DiagnosticInspector.js';
import { PatchWorkspace } from './components/PatchWorkspace.js';
import { PipelineEventStream } from './components/PipelineEventStream.js';
import { PipelineStatusPanel } from './components/PipelineStatusPanel.js';
import { SessionHeader } from './components/SessionHeader.js';
import { TelemetryHUD } from './components/TelemetryHUD.js';
import type {
  LivePipelinePhase,
  WorkbenchSessionState,
  WorkbenchStreamEvent,
  WorkspaceFile
} from './types.js';
import {
  canonicalizeWorkspacePath,
  workspacePathsEqual
} from './utils/workspacePath.js';
import { AnalyticsView } from './components/AnalyticsView.js';

const API_BASE = 'http://localhost:3000/api';
const EXPERIMENT_INFERENCE_TIMEOUT_MS = 120_000;

interface ModelPreset {
  readonly identifier: string;
  readonly label: string;
  readonly apiBaseUrl: string;
}

const MODEL_PRESETS: readonly ModelPreset[] = [
  { identifier: 'qwen2.5-coder:7b', label: 'Qwen2.5-Coder 7B · Ollama', apiBaseUrl: 'http://127.0.0.1:11434/v1' },
  { identifier: 'deepseek-coder:6.7b', label: 'DeepSeek-Coder 6.7B · Ollama', apiBaseUrl: 'http://127.0.0.1:11434/v1' },
  { identifier: 'codellama:7b', label: 'CodeLlama 7B · Ollama', apiBaseUrl: 'http://127.0.0.1:11434/v1' }
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

const fieldLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem', color: '#888', display: 'block', marginBottom: '4px'
};

const fieldControlStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', boxSizing: 'border-box', background: '#1e1e1e',
  border: '1px solid #444', color: '#fff', borderRadius: '3px'
};

const gridFourStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '12px', marginBottom: '12px'
};

interface TextSettingProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}

function TextSetting({ id, label, value, placeholder, disabled, onChange }: TextSettingProps): React.JSX.Element {
  return (
    <div>
      <label htmlFor={id} style={fieldLabelStyle}>{label}</label>
      <input id={id} value={value} placeholder={placeholder} disabled={disabled}
        onChange={(event) => onChange(event.target.value)} style={fieldControlStyle} />
    </div>
  );
}

interface ManifestSettingProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}

function ManifestSetting({
  id,
  label,
  value,
  disabled,
  onChange
}: ManifestSettingProps): React.JSX.Element {
  return (
    <div>
      <label
        htmlFor={id}
        style={fieldLabelStyle}
      >
        {label}
      </label>

      <textarea
        id={id}
        value={value}
        disabled={disabled}
        rows={4}
        spellCheck={false}
        placeholder="Un file per riga"
        onChange={(event) =>
          onChange(event.target.value)
        }
        style={{
          ...fieldControlStyle,
          minHeight: 92,
          resize: 'vertical',
          fontFamily: 'monospace'
        }}
      />
    </div>
  );
}


function NumberSetting({ label, value, min, max, step, disabled, onChange }: {
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
      <label style={fieldLabelStyle}>{label}</label>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))} style={fieldControlStyle} />
    </div>
  );
}

function isRecord(
  value: unknown
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonNegativeInteger(
  value: unknown
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isNonNegativeFiniteNumber(
  value: unknown
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isNullableNonNegativeInteger(
  value: unknown
): value is number | null {
  return (
    value === null ||
    isNonNegativeInteger(value)
  );
}

function isPhaseTransitionPayload(
  value: unknown
): value is Extract<
  WorkbenchStreamEvent,
  { readonly type: 'PHASE_TRANSITION' }
>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonNegativeInteger(value.iteration) &&
    (
      value.state === 'INSPECTION' ||
      value.state === 'EVALUATION' ||
      value.state === 'REFINEMENT'
    )
  );
}

function isOracleProgressPayload(
  value: unknown
): value is Extract<
  WorkbenchStreamEvent,
  { readonly type: 'ORACLE_PROGRESS' }
>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (
      value.tool === 'BUILD_SYNTAX' ||
      value.tool === 'SEMGREP' ||
      value.tool === 'TEST_HARNESS'
    ) &&
    typeof value.completed === 'boolean' &&
    isNonNegativeInteger(value.findingsCount)
  );
}

function isTelemetryUpdatePayload(
  value: unknown
): value is Extract<
  WorkbenchStreamEvent,
  { readonly type: 'TELEMETRY_UPDATE' }
>['payload'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNullableNonNegativeInteger(
      value.promptTokens
    ) &&
    isNullableNonNegativeInteger(
      value.completionTokens
    ) &&
    typeof value.tokenUsageAvailable ===
    'boolean' &&
    isNonNegativeFiniteNumber(
      value.durationMs
    ) &&
    (
      value.tokenUsageAvailable
        ? value.promptTokens !== null &&
        value.completionTokens !== null
        : value.promptTokens === null &&
        value.completionTokens === null
    )
  );
}

function hasIterationCompleteIdentity(
  value: unknown
): value is Readonly<{
  taskId: string;
}> {
  return (
    isRecord(value) &&
    typeof value.taskId === 'string' &&
    value.taskId.trim().length > 0
  );
}

type IncrementalStreamEvent =
  Exclude<
    WorkbenchStreamEvent,
    { readonly type: 'ITERATION_COMPLETE' }
  >;

type PhaseTransitionPayload =
  Extract<
    IncrementalStreamEvent,
    { readonly type: 'PHASE_TRANSITION' }
  >['payload'];

type OracleProgressPayload =
  Extract<
    IncrementalStreamEvent,
    { readonly type: 'ORACLE_PROGRESS' }
  >['payload'];

type TelemetryUpdatePayload =
  Extract<
    IncrementalStreamEvent,
    { readonly type: 'TELEMETRY_UPDATE' }
  >['payload'];

function parseWorkbenchStreamPayload(
  expectedType: 'PHASE_TRANSITION',
  rawData: string
): PhaseTransitionPayload | null;

function parseWorkbenchStreamPayload(
  expectedType: 'ORACLE_PROGRESS',
  rawData: string
): OracleProgressPayload | null;

function parseWorkbenchStreamPayload(
  expectedType: 'TELEMETRY_UPDATE',
  rawData: string
): TelemetryUpdatePayload | null;

function parseWorkbenchStreamPayload(
  expectedType:
    IncrementalStreamEvent['type'],
  rawData: string
):
  | PhaseTransitionPayload
  | OracleProgressPayload
  | TelemetryUpdatePayload
  | null {
  let parsed: unknown;

  try {
    parsed =
      JSON.parse(rawData) as unknown;
  } catch {
    return null;
  }

  switch (expectedType) {
    case 'PHASE_TRANSITION':
      return isPhaseTransitionPayload(parsed)
        ? parsed
        : null;

    case 'ORACLE_PROGRESS':
      return isOracleProgressPayload(parsed)
        ? parsed
        : null;

    case 'TELEMETRY_UPDATE':
      return isTelemetryUpdatePayload(parsed)
        ? parsed
        : null;
  }
}

function parseIterationCompleteIdentity(
  rawData: string
): Readonly<{
  taskId: string;
}> | null {
  let parsed: unknown;

  try {
    parsed =
      JSON.parse(rawData) as unknown;
  } catch {
    return null;
  }

  return hasIterationCompleteIdentity(parsed)
    ? parsed
    : null;
}

function parseManifestFiles(
  value: string
): readonly string[] {
  const normalizedFiles =
    value
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter((file) => file.length > 0);

  return Array.from(
    new Set(normalizedFiles)
  );
}

function serializeManifestFiles(
  files: readonly string[]
): string {
  return files.join('\n');
}


export const App: React.FC = () => {
  const [repoPath, setRepoPath] = useState('C:\\Users\\v.papa\\OneDrive - Avanade\\Personale\\Tesi\\target-repositories\\sandbox_test');
  const [taskId, setTaskId] = useState('task-001');
  const [issueSpec, setIssueSpec] = useState('Fix SQL injection vulnerability in authenticate() and ensure test suite passes.');
  const [targetFilesText, setTargetFilesText] = useState('service.py');
  const [testFilesText, setTestFilesText] = useState('test_service.py');
  const [targetFiles, setTargetFiles] = useState<readonly string[]>(['service.py']);
  const [testFiles, setTestFiles] = useState<readonly string[]>(['test_service.py']);
  const [taskCategory, setTaskCategory] = useState<ExperimentCategory>('REPAIR');
  const [modelIdentifier, setModelIdentifier] = useState('qwen2.5-coder:7b');
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [modelSeed, setModelSeed] = useState(42);
  const [modelTemperature, setModelTemperature] = useState(0);
  const [modelTopP, setModelTopP] = useState(1);
  const [session, setSession] = useState<WorkbenchSessionState | null>(null);
  const [livePhase, setLivePhase] = useState<LivePipelinePhase | null>(null);
  const [selectedIteration, setSelectedIteration] = useState(1);
  const [fallbackOriginalCode, setFallbackOriginalCode] = useState('');
  const [fallbackModifiedCode, setFallbackModifiedCode] = useState('');
  const [humanOverrideDrafts, setHumanOverrideDrafts] = useState<Readonly<Record<string, string>>>({});
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly WorkspaceFile[]>([]);
  const [workspaceOriginalSources, setWorkspaceOriginalSources] = useState<Readonly<Record<string, string>>>({});
  const [workspaceTestSources, setWorkspaceTestSources] = useState<Readonly<Record<string, string>>>({});
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [sseLogs, setSseLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'WORKSPACE' | 'ANALYTICS'>('WORKSPACE');
  const [replayRunId, setReplayRunId] = useState<string | null>(null);
  const [executionMode, setExecutionMode] = useState<'BASELINE' | 'MULTI_AGENT' | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const finalizationLockRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeStreamTaskIdRef = useRef<string | null>(null);
  const streamGenerationRef = useRef(0);

  const isCreateMode = taskCategory === 'CREATE';
  const primaryTargetFile = targetFiles[0] ?? '';
  const disabledConfiguration = isRunning || !!replayRunId;
  const currentIterData = session?.iterations[selectedIteration - 1];
  const autonomousStatus = session?.autonomousStatus ??
    (session?.status === 'CONVERGED' ||
      session?.status === 'UNRESOLVED' ||
      session?.status === 'FAILED' ||
      session?.status === 'INFRASTRUCTURE_ERROR'
      ? session.status
      : null);
  const finalizationStatus = session?.finalizationStatus ?? 'NOT_FINALIZED';
  const isHumanAugmented = finalizationStatus === 'APPROVED' && session?.isHumanAugmented === true;
  const hasPendingHumanOverride = Object.keys(humanOverrideDrafts).length > 0;
  const dirtyFilePaths = new Set(Object.keys(humanOverrideDrafts));
  const canApproveAutonomous =
    !replayRunId &&
    !!session &&
    finalizationStatus === 'NOT_FINALIZED' &&
    autonomousStatus === 'CONVERGED' &&
    session.candidateVerified === true;

  const canApproveHumanOverride =
    !replayRunId &&
    !!session &&
    finalizationStatus === 'NOT_FINALIZED' &&
    hasPendingHumanOverride &&
    (
      autonomousStatus === 'CONVERGED' ||
      autonomousStatus === 'UNRESOLVED' ||
      autonomousStatus === 'FAILED'
    );

  const canApprove =
    canApproveHumanOverride ||
    canApproveAutonomous;


  const canReject = !replayRunId && !!session && finalizationStatus === 'NOT_FINALIZED' && (
    autonomousStatus === 'CONVERGED' ||
    autonomousStatus === 'UNRESOLVED' ||
    autonomousStatus === 'FAILED' ||
    autonomousStatus === 'INFRASTRUCTURE_ERROR'
  );

  const resetExecutionState = (): void => {
    closeEventSource();
    setSession(null);
    setWorkspaceFiles([]);
    setWorkspaceOriginalSources({});
    setWorkspaceTestSources({});
    setHumanOverrideDrafts({});
    setSelectedFilePath('');
    setSelectedIteration(1);
    setFallbackOriginalCode('');
    setFallbackModifiedCode('');
    setStatusMessage(null);
    setLivePhase(null);
    setSseLogs([]);
    setExecutionMode(null);
  };

  const loadPersistedRun = async (runId: string): Promise<StoredRun> => {
    const response = await fetch(`${API_BASE}/experiments/${encodeURIComponent(runId)}`);
    const text = await response.text();
    const data = text.trim() ? JSON.parse(text) as unknown : undefined;
    if (!response.ok) {
      const errorData = typeof data === 'object' && data !== null ? data as { error?: unknown } : null;
      throw new Error(String(errorData?.error ?? `Run ${runId} non recuperabile.`));
    }
    return data as StoredRun;
  };

  const applyTerminalExecutionState = (state: WorkbenchSessionState): void => {
    setSession(state);
    setSelectedIteration(Math.max(1, state.currentIteration));
    setLivePhase(null);
    const isFailure = state.status === 'FAILED' || state.status === 'UNRESOLVED' || state.status === 'INFRASTRUCTURE_ERROR';
    const details = state.failure ?
      `${state.failure.phase} / ${state.failure.category}: ${state.failure.message}`
      : state.terminationReason ?? '';
    setStatusMessage({
      text: `${state.category} concluso con stato ${state.status} (Iterazione ${state.currentIteration}/${state.maxIterations}). ${details}`,
      isError: isFailure
    });
  };

  const reportInvalidStreamEvent = (
    eventType: WorkbenchStreamEvent['type']
  ): void => {
    setSseLogs((previous) => [
      ...previous,
      `[SSE] Evento ${eventType} ignorato: payload non valido.`
    ]);
  };

  const closeEventSource = (): void => {
    const current =
      eventSourceRef.current;

    eventSourceRef.current = null;
    activeStreamTaskIdRef.current = null;

    if (current) {
      current.close();
    }
  };

  const openEventSource = (
    executionTaskId: string
  ): number => {
    closeEventSource();

    const streamGeneration =
      streamGenerationRef.current + 1;

    streamGenerationRef.current =
      streamGeneration;

    const sse =
      new EventSource(
        `${API_BASE}/tasks/` +
        `${encodeURIComponent(executionTaskId)}/stream`
      );

    eventSourceRef.current = sse;
    activeStreamTaskIdRef.current =
      executionTaskId;

    const isCurrentStream = (): boolean =>
      eventSourceRef.current === sse &&
      activeStreamTaskIdRef.current ===
      executionTaskId &&
      streamGenerationRef.current ===
      streamGeneration;

    sse.addEventListener(
      'PHASE_TRANSITION',
      (event: MessageEvent<string>) => {
        if (!isCurrentStream()) {
          return;
        }

        const payload =
          parseWorkbenchStreamPayload(
            'PHASE_TRANSITION',
            event.data
          );

        if (!payload) {
          reportInvalidStreamEvent(
            'PHASE_TRANSITION'
          );
          return;
        }

        setLivePhase(payload.state);


        setSseLogs((previous) => [
          ...previous,
          `[FSM] Iterazione #${payload.iteration} ` +
          `-> Stato: ${payload.state}`
        ]);
      }
    );

    sse.addEventListener(
      'ORACLE_PROGRESS',
      (event: MessageEvent<string>) => {
        if (!isCurrentStream()) {
          return;
        }

        const payload =
          parseWorkbenchStreamPayload(
            'ORACLE_PROGRESS',
            event.data
          );

        if (!payload) {
          reportInvalidStreamEvent(
            'ORACLE_PROGRESS'
          );
          return;
        }

        setSseLogs((previous) => [
          ...previous,
          `[Oracle] ${payload.tool}: ` +
          `${payload.completed ? 'completato' : 'in corso'} ` +
          `(${payload.findingsCount} anomalie/fallimenti)`
        ]);
      }
    );

    sse.addEventListener(
      'TELEMETRY_UPDATE',
      (event: MessageEvent<string>) => {
        if (!isCurrentStream()) {
          return;
        }

        const payload =
          parseWorkbenchStreamPayload(
            'TELEMETRY_UPDATE',
            event.data
          );

        if (!payload) {
          reportInvalidStreamEvent(
            'TELEMETRY_UPDATE'
          );
          return;
        }

        const tokenSummary =
          payload.tokenUsageAvailable
            ? `${payload.promptTokens ?? 0} prompt + ` +
            `${payload.completionTokens ?? 0} completion token`
            : 'token usage non disponibile';

        setSseLogs((previous) => [
          ...previous,
          `[Telemetry] ${tokenSummary}; ` +
          `durata ${payload.durationMs} ms`
        ]);
      }
    );

    sse.addEventListener(
      'ITERATION_COMPLETE',
      (event: MessageEvent<string>) => {
        if (!isCurrentStream()) {
          return;
        }

        const payload =
          parseIterationCompleteIdentity(
            event.data
          );

        if (!payload) {
          reportInvalidStreamEvent(
            'ITERATION_COMPLETE'
          );
          return;
        }

        if (payload.taskId !== executionTaskId) {
          reportInvalidStreamEvent(
            'ITERATION_COMPLETE'
          );
          return;
        }

        setSseLogs((previous) => [
          ...previous,
          `[FSM] Elaborazione terminale ricevuta ` +
          `per task ${payload.taskId}; ` +
          `in attesa della response HTTP autoritativa.`
        ]);
      });

    sse.onerror = () => {
      if (!isCurrentStream()) {
        return;
      }

      setSseLogs((previous) => [
        ...previous,
        '[SSE] Connessione stream interrotta; ' +
        'l’esecuzione HTTP resta autoritativa.'
      ]);

      closeEventSource();
    };
    return streamGeneration;
  };


  useEffect(() => {
    return () => {
      const current = eventSourceRef.current;
      eventSourceRef.current = null;
      activeStreamTaskIdRef.current = null;
      current?.close();
    };
  }, []);


  const readRepositoryFile = async (filePath: string): Promise<string | null> => {
    const requestUrl = `${API_BASE}/files/read?repoPath=${encodeURIComponent(repoPath)}&filePath=${encodeURIComponent(filePath)}`;
    const response = await fetch(requestUrl);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Impossibile leggere ${filePath} (${response.status}).`);
    const data = await response.json() as { content?: string };
    return data.content ?? '';
  };

  const loadOriginalCode = async (): Promise<string> => {
    if (!primaryTargetFile) {
      if (taskCategory === 'CREATE') {
        setFallbackOriginalCode('');
        return '';
      }
      throw new Error('Dichiara almeno un file target.');
    }
    try {
      const content = await readRepositoryFile(primaryTargetFile);

      if (
        content === null &&
        taskCategory === 'CREATE'
      ) {
        setFallbackOriginalCode('');
        return '';
      }

      if (content === null) {
        throw new Error(
          `File target non trovato: ${primaryTargetFile}`
        );
      }

      setFallbackOriginalCode(content);
      return content;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      setFallbackOriginalCode('');

      setStatusMessage({
        text:
          `Impossibile leggere il target ` +
          `"${primaryTargetFile}": ${message}`,
        isError: true
      });

      throw error;
    }
  };


  const handleOverrideChange = (filePath: string, updatedSource: string): void => {
    const file = workspaceFiles.find((candidate) => workspacePathsEqual(
      candidate.path,
      filePath
    ));
    if (!file) return;
    if (file.status === 'UNCHANGED') {
      return;
    }

    setHumanOverrideDrafts((current) => {
      const next = { ...current };
      const canonicalKey = file.path;
      if (updatedSource === file.modifiedContent) {
        delete next[canonicalKey];
      } else {
        next[canonicalKey] = updatedSource;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!replayRunId) void loadOriginalCode();
  }, [repoPath, primaryTargetFile, taskCategory, replayRunId]);

  useEffect(() => {
    const updateWorkspace = async (): Promise<void> => {
      if (!session) {
        setWorkspaceFiles([]);
        setSelectedFilePath('');
        return;
      }

      const index =
        Math.max(
          0,
          Math.min(
            selectedIteration - 1,
            Math.max(
              0,
              session.iterations.length - 1
            )
          )
        );

      const record =
        session.iterations[index];

      const fileDiffs =
        record?.patchDiff &&
          record.isApplicable
          ? parseFileDiffs(
            record.patchDiff
          )
          : [];

      const diffByPath =
        new Map(
          fileDiffs.map(
            (fileDiff) => [
              canonicalizeWorkspacePath(
                fileDiff.file
              ),
              fileDiff
            ] as const
          )
        );

      const normalizedTargetPaths =
        targetFiles.map(
          canonicalizeWorkspacePath
        );

      const normalizedTestPaths =
        testFiles.map(
          canonicalizeWorkspacePath
        );

      const targetPathSet =
        new Set(
          normalizedTargetPaths
        );

      const testPathSet =
        new Set(
          normalizedTestPaths
        );

      for (
        const patchedPath
        of diffByPath.keys()
      ) {
        if (
          !targetPathSet.has(patchedPath) &&
          !testPathSet.has(patchedPath)
        ) {
          throw new Error(
            `La patch contiene il file ${patchedPath}, ` +
            `che non appartiene al manifest target/test.`
          );
        }
      }

      const materializablePaths =
        [
          ...normalizedTargetPaths,
          ...normalizedTestPaths
        ].filter(
          (filePath, index, values) =>
            values.indexOf(filePath) === index
        ).filter(
          (filePath) =>
            targetPathSet.has(filePath) ||
            getOriginalSource(
              filePath,
              workspaceTestSources
            ) !== undefined ||
            diffByPath.has(filePath)
        );

      const files: WorkspaceFile[] =
        materializablePaths.map(
          (manifestPath) => {
            const role =
              targetPathSet.has(
                manifestPath
              )
                ? 'TARGET' as const
                : 'TEST' as const;

            const sourceMap =
              role === 'TARGET'
                ? workspaceOriginalSources
                : workspaceTestSources;

            const fileDiff =
              diffByPath.get(
                manifestPath
              );

            const snapshotContent =
              getOriginalSource(
                manifestPath,
                sourceMap
              );

            if (
              snapshotContent === undefined &&
              !fileDiff?.isNewFile
            ) {
              throw new Error(
                `Snapshot storica non disponibile per ` +
                `${role} ${manifestPath}.`
              );
            }

            const originalContent =
              fileDiff?.isNewFile
                ? ''
                : snapshotContent ?? '';

            if (!fileDiff) {
              return {
                path: manifestPath,
                originalContent,
                modifiedContent:
                  originalContent,
                status:
                  'UNCHANGED' as const,
                role
              };
            }

            const modifiedContent =
              applyHunksToContent(
                originalContent,
                fileDiff.hunks
              );

            if (modifiedContent === null) {
              throw new Error(
                `Impossibile applicare deterministicamente ` +
                `gli hunk alla snapshot di ${manifestPath}.`
              );
            }

            return {
              path: manifestPath,
              originalContent,
              modifiedContent,
              status:
                fileDiff.isNewFile
                  ? 'NEW' as const
                  : 'MODIFIED' as const,
              role
            };
          }
        );

      setWorkspaceFiles(files);

      const preferred =
        files.find(
          (file) =>
            workspacePathsEqual(
              file.path,
              selectedFilePath
            )
        ) ??
        files.find(
          (file) =>
            file.role === 'TARGET'
        ) ??
        files[0];

      if (!preferred) {
        setSelectedFilePath('');
        return;
      }

      setSelectedFilePath(
        preferred.path
      );

    };

    void updateWorkspace().catch(
      (error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        setWorkspaceFiles([]);
        setSelectedFilePath('');
        setFallbackOriginalCode('');
        setFallbackModifiedCode('');

        setStatusMessage({
          text:
            `Impossibile ricostruire ` +
            `il workspace: ${message}`,
          isError: true
        });
      }
    );
  }, [
    session,
    selectedIteration,
    targetFiles,
    testFiles,
    workspaceOriginalSources,
    workspaceTestSources
  ]);

  useEffect(() => {
    if (!session) {
      setFallbackModifiedCode(
        fallbackOriginalCode
      );
    }
  }, [
    session,
    fallbackOriginalCode
  ]);

  const handleApplyPreset = (presetId: string): void => {
    const preset = BENCHMARK_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }
    setReplayRunId(null);
    resetExecutionState();

    setTaskId(preset.id);
    setIssueSpec(preset.issueSpec);
    setTargetFiles([preset.targetFile]);
    setTestFiles([preset.testFile]);
    setTargetFilesText(preset.targetFile);
    setTestFilesText(preset.testFile);
    setTaskCategory('REPAIR');

  };

  const handleSelectModel = (identifier: string): void => {
    const profile = MODEL_PRESETS.find((candidate) => candidate.identifier === identifier);
    if (!profile) return;
    setModelIdentifier(profile.identifier);
    setApiBaseUrl(profile.apiBaseUrl);
  };

  // Profilo temporaneo P1.3: Python + pytest. La configurazione UI sarà introdotta in una milestone futura.
  const createPythonOracleConfigs = (
    targetFiles: readonly string[],
    testFiles: readonly string[]
  ): {
    readonly buildOracleConfig: {
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly timeoutMs: number;
      readonly envAllowList: readonly string[];
    };
    readonly functionalTestOracleConfig: FunctionalTestOracleConfig;
  } => {
    const targets = targetFiles.map((file) => file.trim()).filter((file) => file.length > 0);
    const oracleFiles = testFiles
      .map((file) => file.trim())
      .filter((file) => file.length > 0);

    if (targets.length === 0) {
      throw new Error('Dichiara almeno un file target.');
    }

    if (oracleFiles.length === 0) {
      throw new Error('Dichiara almeno un file di test funzionale.');
    }

    const envAllowList = [
      'PATH',
      'PATHEXT',
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP'
    ] as const;

    return {
      buildOracleConfig: {
        command: 'python',
        args: ['-B', '-m', 'py_compile', ...targets],
        cwd: '.',
        timeoutMs: 30_000,
        envAllowList
      },
      functionalTestOracleConfig: {
        command: 'python',
        args: ['-B', '-m', 'pytest', '--maxfail=5', '-q'],
        cwd: '.',
        timeoutMs: 30_000,
        oracleFiles,
        envAllowList,
        expectedExitPolicy: {
          passExitCodes: [0],
          failExitCodes: [1],
          executionErrorExitCodes: [2, 3, 4, 5]
        },
        allowImplicitDiscovery: false
      }
    };
  };

  const handleExecute = async (isBaseline: boolean): Promise<void> => {
    const executionTaskId = taskId.trim();
    if (!executionTaskId) {
      setStatusMessage({
        text: 'Task ID obbligatorio.',
        isError: true
      });
      return;
    }
    const requestedTargetFiles =
      normalizeManifestFiles(
        parseManifestFiles(
          targetFilesText
        )
      );

    const requestedTestFiles =
      normalizeManifestFiles(
        parseManifestFiles(
          testFilesText
        )
      );

    if (requestedTargetFiles.length === 0) {
      setStatusMessage({
        text:
          'Dichiara almeno un file target.',
        isError: true
      });

      return;
    }

    if (requestedTestFiles.length === 0) {
      setStatusMessage({
        text:
          'Dichiara almeno un file di test funzionale.',
        isError: true
      });

      return;
    }

    const requestedTargetPathSet =
      new Set(
        requestedTargetFiles.map(
          canonicalizeWorkspacePath
        )
      );

    const overlappingPaths =
      requestedTestFiles.filter(
        (filePath) =>
          requestedTargetPathSet.has(
            canonicalizeWorkspacePath(filePath)
          )
      );

    if (overlappingPaths.length > 0) {
      setStatusMessage({
        text:
          `I seguenti file sono dichiarati sia ` +
          `TARGET sia TEST: ` +
          `${overlappingPaths.join(', ')}`,
        isError: true
      });

      return;
    }
    setExecutionMode(isBaseline ? 'BASELINE' : 'MULTI_AGENT');
    setReplayRunId(null);
    setSession(null);
    setSelectedIteration(1);
    setWorkspaceFiles([]);
    setWorkspaceOriginalSources({});
    setWorkspaceTestSources({});
    setHumanOverrideDrafts({});
    setSelectedFilePath('');
    setLivePhase('INSPECTION');
    setFallbackModifiedCode('');
    setIsRunning(true);
    const executionStreamGeneration = openEventSource(executionTaskId);
    setStatusMessage(null);
    setSseLogs([`[Client] Avvio task ${executionTaskId} [${taskCategory}] (${isBaseline ? 'Baseline Single-Agent' : 'Multi-Agent Loop'})...`]);
    let terminalStateApplied = false;
    try {
      await loadOriginalCode();
      setTargetFiles(
        requestedTargetFiles
      );

      setTestFiles(
        requestedTestFiles
      );



      const {
        buildOracleConfig,
        functionalTestOracleConfig
      } = createPythonOracleConfigs(requestedTargetFiles, requestedTestFiles);

      const response = await fetch(`${API_BASE}/tasks/${encodeURIComponent(executionTaskId)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoPath,
          issueSpec,
          targetFiles: requestedTargetFiles,
          testFiles: requestedTestFiles,
          category: taskCategory,
          modelConfig: {
            apiBaseUrl,
            modelIdentifier,
            seed: modelSeed,
            temperature: modelTemperature,
            topP: modelTopP,
            inferenceTimeoutMs:
              EXPERIMENT_INFERENCE_TIMEOUT_MS
          },
          buildOracleConfig,
          functionalTestOracleConfig,
          executionMode: isBaseline ? 'BASELINE' : 'MULTI_AGENT'
        })
      });
      const responseText = await response.text();
      const data = responseText.trim() ? JSON.parse(responseText) as unknown : undefined;
      if (!response.ok) {
        const errorData =
          typeof data === 'object' &&
            data !== null
            ? data as {
              error?: unknown;
              details?: unknown;
              result?: WorkbenchSessionState;
            }
            : null;
        if (errorData?.result) {
          applyTerminalExecutionState(errorData.result);
          terminalStateApplied = true;
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${String(errorData?.error ?? data ?? 'Unknown error')} ${errorData?.details ? JSON.stringify(errorData.details) : ''}`);
      }
      const state = data as WorkbenchSessionState;
      if (!state.runId) {
        throw new Error('La response autoritativa /execute non contiene runId');
      }
      const persistedRun = await loadPersistedRun(state.runId);
      setWorkspaceOriginalSources(persistedRun.targetSources);
      setWorkspaceTestSources(persistedRun.schemaVersion === 4 ? persistedRun.testSources : {});
      setTargetFiles([...persistedRun.session.targetFiles]);
      setTestFiles([...persistedRun.session.testFiles]);
      setTargetFilesText(
        serializeManifestFiles(
          persistedRun.session.targetFiles
        )
      );

      setTestFilesText(
        serializeManifestFiles(
          persistedRun.session.testFiles
        )
      );

      applyTerminalExecutionState(state);
      terminalStateApplied = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (!terminalStateApplied) {
        setLivePhase(null);
        setStatusMessage({ text: `Errore durante l'esecuzione del task: ${message}`, isError: true });
      }
      setSseLogs((previous) => [...previous, `[Execution] ${message}`]);
    } finally {
      if (streamGenerationRef.current === executionStreamGeneration) {
        closeEventSource();
        setIsRunning(false);
      }
    }
  };


  const normalizeManifestFiles = (
    files: readonly string[]
  ): readonly string[] => {
    const filesByNormalizedPath =
      new Map<string, string>();

    for (const file of files) {
      const trimmedFile =
        file.trim();

      if (!trimmedFile) {
        continue;
      }

      const normalizedPath =
        canonicalizeWorkspacePath(
          trimmedFile
        );

      if (
        !filesByNormalizedPath.has(
          normalizedPath
        )
      ) {
        filesByNormalizedPath.set(
          normalizedPath,
          trimmedFile
        );
      }
    }

    return Array.from(
      filesByNormalizedPath.values()
    );
  };

  const getOriginalSource = (filePath: string, sources: Readonly<Record<string, string>>): string | undefined => {
    const canonicalFilePath = canonicalizeWorkspacePath(filePath);
    const exact = sources[canonicalFilePath];
    if (exact !== undefined) {
      return exact;
    }
    const matchingEntry = Object.entries(sources).find(([sourcePath]) => workspacePathsEqual(
      sourcePath,
      canonicalFilePath
    )
    );
    return matchingEntry?.[1];
  };

  const handleReplay = (
    run: StoredRun
  ): void => {
    closeEventSource();
    setHumanOverrideDrafts({});

    const replayTargetFiles =
      [...run.session.targetFiles];

    const replayTestFiles =
      [...run.session.testFiles];

    const replayTestSources =
      run.schemaVersion === 4
        ? run.testSources
        : {};

    setExecutionMode(
      run.metadata.mode
    );

    setTaskCategory(
      run.metadata.category
    );

    setReplayRunId(
      run.metadata.runId
    );

    setSession(
      run.session
    );

    setTargetFiles(
      replayTargetFiles
    );

    setTestFiles(
      replayTestFiles
    );

    setWorkspaceOriginalSources(
      run.targetSources
    );

    setWorkspaceTestSources(
      replayTestSources
    );

    setTaskId(
      run.session.taskId
    );

    setIssueSpec(
      run.session.issueSpec
    );

    setApiBaseUrl(
      run.modelConfig.baseUrl
    );

    setModelIdentifier(
      run.modelConfig.modelName
    );

    setModelSeed(
      run.modelConfig.seed
    );

    setModelTemperature(
      run.modelConfig.temperature
    );

    setModelTopP(
      run.modelConfig.topP
    );

    setWorkspaceFiles([]);


    setTargetFilesText(
      serializeManifestFiles(
        replayTargetFiles
      )
    );

    setTestFilesText(
      serializeManifestFiles(
        replayTestFiles
      )
    );


    const initialReplayFile =
      replayTargetFiles[0] ||
      replayTestFiles[0] ||
      Object.keys(run.targetSources)[0] ||
      Object.keys(replayTestSources)[0] ||
      '';

    setSelectedFilePath(
      initialReplayFile
    );

    setSelectedIteration(
      Math.max(
        1,
        run.session.currentIteration
      )
    );

    if (
      replayTargetFiles.length === 0 &&
      replayTestFiles.length === 0
    ) {
      const replayFallbackContent =
        getOriginalSource(
          initialReplayFile,
          run.targetSources
        ) ??
        getOriginalSource(
          initialReplayFile,
          replayTestSources
        ) ??
        '';

      setFallbackOriginalCode(
        replayFallbackContent
      );
      setFallbackModifiedCode(
        replayFallbackContent
      );
    }


    setLivePhase(null);


    setActiveTab('WORKSPACE');

    if (
      run.schemaVersion !== 4 &&
      replayTestFiles.length > 0
    ) {
      setStatusMessage({
        text:
          `Replay run ${run.metadata.runId.slice(0, 8)} · ` +
          `${run.metadata.timestamp}. ` +
          `Il manifest test è disponibile, ma le snapshot ` +
          `storiche dei test non erano persistite prima ` +
          `dello schema V4.`,
        isError: false
      });
    } else {
      setStatusMessage({
        text:
          `Replay run ${run.metadata.runId.slice(0, 8)} · ` +
          `${run.metadata.timestamp}`,
        isError: false
      });
    }
  };



  const beginFinalization = (): boolean => {
    if (finalizationLockRef.current || isRunning) return false;
    finalizationLockRef.current = true;
    setIsFinalizing(true);
    return true;
  };
  const endFinalization = (): void => {
    finalizationLockRef.current = false;
    setIsFinalizing(false);
  };

  const callFinalization = async (overrideDiff?: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath, ...(overrideDiff ? { overrideDiff } : {}) })
    });
    const text = await response.text();
    const data = text.trim() ? JSON.parse(text) as { error?: string; commitHash?: string; alreadyApproved?: boolean; committed?: boolean } : {};
    if (!response.ok) throw new Error(data.error ?? `Finalizzazione non riuscita (HTTP ${response.status}).`);
    if (!data.commitHash) throw new Error("Il server non ha restituito l'hash del commit.");
    setSession((current) => current ? {
      ...current,
      finalizationStatus: 'APPROVED',
      approvalCommitHash: data.commitHash,
      isHumanAugmented: overrideDiff !== undefined ? true : current.isHumanAugmented ?? false,
      ...(overrideDiff !== undefined ? { finalPatch: overrideDiff } : {})
    } : current);
    setStatusMessage({
      text: overrideDiff !== undefined
        ? `Human Override verificato e approvato. Commit: ${data.commitHash}`
        : `Patch autonoma approvata. Commit: ${data.commitHash}`,
      isError: false
    });
  };

  const handleApproveAction = async (): Promise<void> => {
    if (hasPendingHumanOverride) {
      await handleHumanOverride();
      return;
    }
    await handleApprove();
  };

  const handleApprove = async (): Promise<void> => {
    if (!beginFinalization()) return;
    try { await callFinalization(); }
    catch (error: unknown) { setStatusMessage({ text: `Errore approvazione: ${error instanceof Error ? error.message : String(error)}`, isError: true }); }
    finally { endFinalization(); }
  };

  const handleReject = async (): Promise<void> => {
    if (!beginFinalization()) return;
    try {
      const response = await fetch(`${API_BASE}/tasks/${taskId}/reject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoPath })
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? `Rollback non riuscito (HTTP ${response.status}).`);
      setSession((current) => current ? { ...current, finalizationStatus: 'REJECTED' } : current);
      setStatusMessage({ text: data.message ?? 'Sessione scartata e repository ripristinato.', isError: false });
    } catch (error: unknown) {
      setStatusMessage({ text: `Errore durante il rollback: ${error instanceof Error ? error.message : String(error)}`, isError: true });
    } finally { endFinalization(); }
  };

  const handleHumanOverride = async (): Promise<void> => {
    if (!hasPendingHumanOverride) {
      setStatusMessage({ text: 'Nessuna modifica Human Override da finalizzare.', isError: true });
      return;
    }
    if (!beginFinalization()) {
      return;
    }
    try {
      const overrideDiffs =
        workspaceFiles.flatMap(
          (file) => {
            if (
              file.status === 'UNCHANGED'
            ) {
              return [];
            }

            const finalContent =
              humanOverrideDrafts[file.path] ??
              file.modifiedContent;

            const diff =
              createFullReplacementDiff(
                file.path,
                file.originalContent,
                finalContent,
                file.status
              );

            return diff === null
              ? []
              : [diff];
          }
        );

      if (overrideDiffs.length === 0) {
        throw new Error('Nessuna modifica Human Override da finalizzare.');
      }
      const overrideDiff = overrideDiffs.join('');
      await callFinalization(overrideDiff);
      setHumanOverrideDrafts({});
    } catch (error: unknown) {
      setStatusMessage({ text: `Errore Human Override: ${error instanceof Error ? error.message : String(error)}`, isError: true });
    } finally {
      endFinalization();
    }
  };

  const selectedWorkspaceFile = workspaceFiles.find((file) => workspacePathsEqual(
    file.path,
    selectedFilePath
  )
  );
  const selectedDraft = selectedWorkspaceFile ? humanOverrideDrafts[selectedWorkspaceFile.path] : undefined;
  const isSelectedFileEdited = selectedWorkspaceFile !== undefined && selectedDraft !== undefined;

  const handleSelectIteration = (iteration: number): void => {
    if (iteration === selectedIteration) {
      return;
    }
    setHumanOverrideDrafts({});
    setSelectedIteration(iteration);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#181818', color: '#ccc' }}>
      {activeTab === 'WORKSPACE' && (
        <SessionHeader
          taskId={taskId}
          autonomousStatus={autonomousStatus ?? null}
          finalizationStatus={finalizationStatus}
          isHumanAugmented={isHumanAugmented}
          targetFiles={session?.targetFiles ?? targetFiles}
          livePhase={livePhase}
          iterationsCount={session?.iterations.length ?? 0}
          selectedIteration={selectedIteration}
          onSelectIteration={handleSelectIteration} />
      )}

      <nav aria-label="Navigazione principale" style={{ display: 'flex', gap: 6, padding: '8px 24px', background: '#202020', borderBottom: '1px solid #333' }}>
        <button onClick={() => setActiveTab('WORKSPACE')} aria-pressed={activeTab === 'WORKSPACE'} style={tabButtonStyle(activeTab === 'WORKSPACE')}><Code2 size={15} /> Workspace</button>
        <button onClick={() => setActiveTab('ANALYTICS')} aria-pressed={activeTab === 'ANALYTICS'} style={tabButtonStyle(activeTab === 'ANALYTICS')}><BarChart3 size={15} /> Research Analytics</button>
      </nav>

      <main style={{ padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {activeTab === 'ANALYTICS' ? <AnalyticsView onReplay={handleReplay} /> : <>
          {statusMessage && (
            <div style={{ padding: '10px 16px', borderRadius: 4, background: statusMessage.isError ? '#5a1d1d' : '#1e4620', color: statusMessage.isError ? '#f48771' : '#4ec9b0', display: 'flex', justifyContent: 'space-between' }}>
              <span>{statusMessage.text}</span>
              <button type="button" onClick={() => setStatusMessage(null)} style={{ background: 'transparent', border: 'none', color: '#fff' }}>✕</button>
            </div>
          )}

          <PipelineStatusPanel
            livePhase={livePhase}
            autonomousStatus={autonomousStatus}
            finalizationStatus={finalizationStatus}
            isRunning={isRunning}
            replayRunId={replayRunId}
            executionMode={executionMode}
            currentIteration={session?.currentIteration ?? 0}
            maxIterations={session?.maxIterations ?? 0}
            selectedIteration={selectedIteration}
            hasIterations={(session?.iterations.length ?? 0) > 0} />

          <section style={{ background: '#252526', padding: '16px 20px', borderRadius: 4, border: '1px solid #333' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '0.95rem', color: '#fff' }}>Configurazione Task & Ingestione Contesto (RF-01)</h2>
              <select onChange={(event) => handleApplyPreset(event.target.value)} defaultValue="" style={fieldControlStyle}>
                <option value="" disabled>Carica Benchmark predefinito...</option>
                {BENCHMARK_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </div>

            <div style={{ ...gridFourStyle, gridTemplateColumns: '1.2fr 2fr 1fr 1fr' }}>
              <TextSetting id="task-id" label="Task ID" value={taskId} disabled={disabledConfiguration} onChange={(value) => { setTaskId(value); resetExecutionState(); }} />
              <TextSetting id="issue-spec" label={isCreateMode ? 'Specifica della nuova funzionalità' : 'Specifiche del difetto'} value={issueSpec} disabled={disabledConfiguration} onChange={(value) => { setIssueSpec(value); resetExecutionState(); }} />
              <ManifestSetting
                id="target-files"
                label={
                  isCreateMode
                    ? 'Nuovi file o entrypoint, uno per riga'
                    : 'File target, uno per riga'
                }
                value={targetFilesText}
                disabled={disabledConfiguration}
                onChange={(value) => {
                  resetExecutionState();
                  setTargetFilesText(value);
                  setTargetFiles(
                    parseManifestFiles(value)
                  );
                }}
              />

              <ManifestSetting
                id="test-files"
                label="File test, uno per riga"
                value={testFilesText}
                disabled={disabledConfiguration}
                onChange={(value) => {
                  resetExecutionState();
                  setTestFilesText(value);
                  setTestFiles(
                    parseManifestFiles(value)
                  );
                }}
              />
            </div>

            <div style={{ ...gridFourStyle, gridTemplateColumns: '1fr 3fr' }}>
              <div><label style={fieldLabelStyle}>Modalità operativa</label><select value={taskCategory} disabled={disabledConfiguration} onChange={(event) => { setTaskCategory(event.target.value as ExperimentCategory); resetExecutionState(); }} style={fieldControlStyle}><option value="REPAIR">REPAIR - Correzione codice</option><option value="CREATE">CREATE - Nuova funzionalità</option></select></div>
              <TextSetting id="repo-path" label="Path Repository Target (Sandbox Locale)" value={repoPath} disabled={disabledConfiguration} onChange={(value) => { setRepoPath(value); resetExecutionState(); }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr repeat(3, minmax(110px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div><label style={fieldLabelStyle}>Modello locale</label><select value={modelIdentifier} disabled={disabledConfiguration} onChange={(event) => handleSelectModel(event.target.value)} style={fieldControlStyle}>{MODEL_PRESETS.map((profile) => <option key={profile.identifier} value={profile.identifier}>{profile.label}</option>)}</select></div>
              <TextSetting id="model-url" label="Endpoint OpenAI-compatible locale" value={apiBaseUrl} disabled={disabledConfiguration} onChange={setApiBaseUrl} />
              <NumberSetting label="Seed" value={modelSeed} min={0} max={2147483647} step={1} disabled={disabledConfiguration} onChange={setModelSeed} />
              <NumberSetting label="Temperature" value={modelTemperature} min={0} max={2} step={0.05} disabled={disabledConfiguration} onChange={setModelTemperature} />
              <NumberSetting label="Top-p" value={modelTopP} min={0.01} max={1} step={0.05} disabled={disabledConfiguration} onChange={setModelTopP} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => handleExecute(true)}
                disabled={isRunning || isFinalizing}
                style={{
                  background: '#333',
                  color: '#eee',
                  border: '1px solid #555',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: isRunning || isFinalizing ? 'not-allowed' : 'pointer',
                  fontWeight: 600
                }}
              >
                Lancia Baseline Single-Agent (RF-09)
              </button>
              <button
                type="button"
                onClick={() => handleExecute(false)}
                disabled={isRunning || isFinalizing}
                style={{
                  background: '#0e639c',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: '4px',
                  cursor: isRunning || isFinalizing ? 'not-allowed' : 'pointer',
                  fontWeight: 600
                }}
              >
                {isRunning
                  ? 'Esecuzione FSM in corso...'
                  : 'Avvia Multi-Agent Self-Refinement (RF-07)'}
              </button>
            </div>
          </section>

          {session && <TelemetryHUD telemetry={currentIterData?.telemetry ?? session.cumulativeTelemetry} overallTelemetry={session.cumulativeTelemetry} currentIteration={selectedIteration} maxIterations={session.maxIterations} />}
          <PatchWorkspace
            targetFile={primaryTargetFile}
            files={workspaceFiles}
            selectedFilePath={selectedFilePath}
            fallbackOriginalCode={fallbackOriginalCode}
            fallbackModifiedCode={fallbackModifiedCode}
            selectedDraft={selectedDraft}
            dirtyFilePaths={dirtyFilePaths}
            findings={currentIterData?.verification?.sastFindings ?? []}
            readOnly={!!replayRunId || isRunning || isFinalizing || finalizationStatus !== 'NOT_FINALIZED'}
            isSelectedFileEdited={isSelectedFileEdited}
            onSelectFile={(filePath) => {
              const file = workspaceFiles.find((item) => workspacePathsEqual(
                item.path,
                filePath
              )
              );
              if (!file) {
                return;
              }
              setSelectedFilePath(file.path);
            }
            }
            onOverrideChange={handleOverrideChange}
          />
          <DiagnosticsInspector semgrepStatus={
            currentIterData?.verification
              ?.oracleResults
              .find((result) => result.oracle === 'SEMGREP')
              ?.status ??
            null
          }
            findings={currentIterData?.verification?.sastFindings ?? []}
            testReport={currentIterData?.verification?.testReport} />
          <PipelineEventStream logs={sseLogs} isRunning={isRunning} />
          <ActionToolbar
            canApprove={canApprove}
            canReject={canReject}
            finalizationStatus={finalizationStatus}
            hasPendingHumanOverride={hasPendingHumanOverride}
            isHumanAugmented={isHumanAugmented}
            isFinalizing={isFinalizing}
            onApprove={handleApproveAction}
            onReject={handleReject} />
        </>}
      </main>
    </div>
  );
};

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px',
    border: `1px solid ${active ? '#4a9fd2' : '#444'}`, borderRadius: 3,
    color: active ? '#d9effb' : '#aaa', background: active ? '#183346' : 'transparent', cursor: 'pointer'
  };
}
