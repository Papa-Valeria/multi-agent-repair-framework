import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, BarChart3, Clock3, GitCompareArrows, Play } from 'lucide-react';
import type {
  AggregatedMetricsReport,
  ExperimentCategory,
  RunSummary,
  StoredRun
} from '../../../src/types/analytics.js';

const API_BASE = 'http://localhost:3000/api';
type Scope = 'GLOBAL' | 'PAIRED';
type SortKey = 'timestamp' | 'taskId' | 'totalTokens' | 'overhead';

interface Props {
  readonly onReplay: (run: StoredRun) => void;
}

const panelStyle: React.CSSProperties = {
  background: '#252526',
  border: '1px solid #3c3c3c',
  borderRadius: 4,
  padding: 16
};

const mutedStyle: React.CSSProperties = { color: '#9da0a5', fontSize: 12 };

function formatPercent(value: number | null): string {
  return value === null ? 'n/d' : `${value.toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/d' : Math.round(value).toLocaleString();
}

function formatDuration(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
}

function formatNullableDuration(value: number | null): string {
  return value === null ? 'n/d' : formatDuration(value);
}

function buildFilterQuery(category: string, modelName: string): string {
  const query = new URLSearchParams();
  if (category !== 'ALL') query.set('category', category);
  if (modelName !== 'ALL') query.set('modelName', modelName);
  const value = query.toString();
  return value ? `?${value}` : '';
}

function Kpi({ label, value, detail, accent }: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly accent: string;
}): React.JSX.Element {
  return (
    <section style={{ ...panelStyle, borderTop: `2px solid ${accent}`, minWidth: 0 }}>
      <div style={mutedStyle}>{label}</div>
      <div style={{ color: '#f2f2f2', fontSize: 24, fontWeight: 650, marginTop: 8 }}>{value}</div>
      <div style={{ ...mutedStyle, marginTop: 5 }}>{detail}</div>
    </section>
  );
}

function TokenChart({ pairs }: { readonly pairs: AggregatedMetricsReport['pairedTasks'] }): React.JSX.Element {
  const height = Math.max(115, pairs.length * 46 + 36);
  const maxTokens = Math.max(1, ...pairs.flatMap((pair) => [pair.baseline.metrics.totalTokens, pair.multiAgent.metrics.totalTokens]));
  return (
    <svg viewBox={`0 0 760 ${height}`} role="img" aria-label="Token footprint per task" style={{ width: '100%', display: 'block' }}>
      {pairs.length === 0 ? <text x="18" y="40" fill="#aeb2b7" fontSize="13">Servono run accoppiati per visualizzare il confronto.</text> : null}
      {pairs.map((pair, index) => {
        const y = 24 + index * 46;
        const baselineCoderPrompt = (pair.baseline.metrics.coderPromptTokens / maxTokens) * 390;
        const baselineCoderCompletion = (pair.baseline.metrics.coderCompletionTokens / maxTokens) * 390;
        const baselineReviewerPrompt = (pair.baseline.metrics.reviewerPromptTokens / maxTokens) * 390;
        const baselineReviewerCompletion = (pair.baseline.metrics.reviewerCompletionTokens / maxTokens) * 390;
        const multiCoderPrompt = (pair.multiAgent.metrics.coderPromptTokens / maxTokens) * 390;
        const multiCoderCompletion = (pair.multiAgent.metrics.coderCompletionTokens / maxTokens) * 390;
        const multiReviewerPrompt = (pair.multiAgent.metrics.reviewerPromptTokens / maxTokens) * 390;
        const multiReviewerCompletion = (pair.multiAgent.metrics.reviewerCompletionTokens / maxTokens) * 390;
        return (
          <g key={`${pair.taskId}-${pair.modelName}`}>
            <text x="8" y={y + 11} fill="#d6d6d6" fontSize="11">{pair.taskId.slice(0, 20)}</text>
            <rect x="170" y={y} width={baselineCoderPrompt} height="12" fill="#276c9b" />
            <rect x={170 + baselineCoderPrompt} y={y} width={baselineCoderCompletion} height="12" fill="#4b99c7" />
            <rect x={170 + baselineCoderPrompt + baselineCoderCompletion} y={y} width={baselineReviewerPrompt} height="12" fill="#687eac" />
            <rect x={170 + baselineCoderPrompt + baselineCoderCompletion + baselineReviewerPrompt} y={y} width={baselineReviewerCompletion} height="12" fill="#9aaed5" />
            <text x="570" y={y + 10} fill="#a9d8f4" fontSize="11">B {pair.baseline.metrics.totalTokens.toLocaleString()}</text>
            <rect x="170" y={y + 17} width={multiCoderPrompt} height="12" fill="#9b641b" />
            <rect x={170 + multiCoderPrompt} y={y + 17} width={multiCoderCompletion} height="12" fill="#c38c39" />
            <rect x={170 + multiCoderPrompt + multiCoderCompletion} y={y + 17} width={multiReviewerPrompt} height="12" fill="#b26d53" />
            <rect x={170 + multiCoderPrompt + multiCoderCompletion + multiReviewerPrompt} y={y + 17} width={multiReviewerCompletion} height="12" fill="#d59b7e" />
            <text x="570" y={y + 27} fill="#f3d99c" fontSize="11">M {pair.multiAgent.metrics.totalTokens.toLocaleString()}</text>
          </g>
        );
      })}
    </svg>
  );
}

function LatencyChart({ report }: { readonly report: AggregatedMetricsReport }): React.JSX.Element {
  if (report.totalRuns === 0) {
    return <div style={mutedStyle}>Nessun dato temporale archiviato per i filtri selezionati.</div>;
  }
  const modes = [
    { key: 'BASELINE' as const, label: 'Baseline', color: '#3185bd' },
    { key: 'MULTI_AGENT' as const, label: 'Multi-Agent', color: '#cb8b28' }
  ];
  const maxDuration = Math.max(1, ...modes.flatMap(({ key }) => [
    report.modes[key].averageInferenceDurationMs ?? 0,
    report.modes[key].averageOracleDurationMs ?? 0
  ]));
  return (
    <svg viewBox="0 0 720 150" role="img" aria-label="Latenza LLM, oracle e overhead" style={{ width: '100%', display: 'block' }}>
      {modes.map(({ key, label, color }, index) => {
        const metric = report.modes[key];
        const y = 24 + index * 57;
        const inference = ((metric.averageInferenceDurationMs ?? 0) / maxDuration) * 420;
        const oracle = ((metric.averageOracleDurationMs ?? 0) / maxDuration) * 420;
        return (
          <g key={key}>
            <text x="8" y={y + 12} fill="#d6d6d6" fontSize="12">{label}</text>
            <rect x="120" y={y} width={inference} height="22" fill={color} />
            <rect x={120 + inference} y={y} width={oracle} height="22" fill="#72a77c" />
            <text x="565" y={y + 14} fill="#d6d6d6" fontSize="11">
              LLM {formatDuration(metric.averageInferenceDurationMs ?? 0)} / oracle {formatDuration(metric.averageOracleDurationMs ?? 0)}
            </text>
          </g>
        );
      })}
      <g fontSize="10" fill="#aeb2b7">
        <rect x="120" y="137" width="9" height="9" fill="#3185bd" /><text x="134" y="145">Inferenza</text>
        <rect x="215" y="137" width="9" height="9" fill="#72a77c" /><text x="229" y="145">Oracle esterni</text>
      </g>
    </svg>
  );
}

function OverheadGauge({ baselineValue, multiAgentValue, metric }: {
  readonly baselineValue: number | null;
  readonly multiAgentValue: number | null;
  readonly metric: 'END_TO_END' | 'ACTIVE_FRAMEWORK';
}): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <OverheadGaugeRow label="Baseline" value={baselineValue} metric={metric} />
      <OverheadGaugeRow label="Multi-Agent" value={multiAgentValue} metric={metric} />
    </div>
  );
}

function OverheadGaugeRow({ label, value, metric }: {
  readonly label: string;
  readonly value: number | null;
  readonly metric: 'END_TO_END' | 'ACTIVE_FRAMEWORK';
}): React.JSX.Element {
  const gaugeWidth = 420;
  const safeValue = value === null ? 0 : Math.max(0, Math.min(value, 20));
  const filledWidth = (safeValue / 20) * gaugeWidth;
  const compliant = metric === 'END_TO_END' && value !== null && value <= 5;
  return (
    <div>
      <div style={{ ...mutedStyle, marginBottom: 2 }}>{label}</div>
      <svg viewBox="0 0 460 68" role="img" aria-label={`${label}: CPU sul tempo framework attivo`} style={{ width: '100%' }}>
        <rect x="12" y="18" width={gaugeWidth} height="16" rx="3" fill="#444" />
        <rect x="12" y="18" width={filledWidth} height="16" rx="3" fill={compliant ? '#5aa879' : '#d17857'} />
        <line x1={12 + gaugeWidth / 4} y1="10" x2={12 + gaugeWidth / 4} y2="42" stroke="#f1d178" strokeWidth="2" />
        <text x="12" y="57" fill="#aeb2b7" fontSize="11">0%</text>
        <text x={12 + gaugeWidth / 4 - 10} y="57" fill="#f1d178" fontSize="11">5%</text>
        <text x={12 + gaugeWidth - 28} y="57" fill="#aeb2b7" fontSize="11">20%+</text>
        <text x="440" y="30" fill={compliant ? '#7bc495' : '#e48c73'} fontSize="12" textAnchor="end">{formatPercent(value)}</text>
      </svg>
      <div style={{ color: compliant ? '#7bc495' : '#e48c73', fontSize: 12 }}>
        {value === null
          ? 'Dato non disponibile'
          : metric === 'ACTIVE_FRAMEWORK'
            ? 'Indicatore diagnostico; non soggetto alla soglia RNF-05'
            : compliant ? 'CONFORME RNF-05 (<= 5%)' : 'Sopra soglia RNF-05'}
      </div>
    </div>
  );
}

function PairedCard({ baseline, multiAgent }: {
  readonly baseline: RunSummary | null;
  readonly multiAgent: RunSummary | null;
}): React.JSX.Element {
  return (
    <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
      {[['Baseline', baseline], ['Multi-Agent', multiAgent]].map(([label, run]) => {
        const summary = run as RunSummary | null;
        return (
          <section key={label as string} style={{ borderLeft: `3px solid ${label === 'Baseline' ? '#3185bd' : '#cb8b28'}`, paddingLeft: 12 }}>
            <strong>{label as string}</strong>
            {summary ? <>
              <div style={{ marginTop: 8 }}>{summary.metadata.status} · {summary.metadata.totalIterations} iterazioni</div>
              <div style={mutedStyle}>{summary.metrics.totalTokens.toLocaleString()} token · {formatPercent(summary.metrics.testPassRatePct)} test pass</div>
              <div style={mutedStyle}>{summary.metrics.residualSastCount} finding SAST · {formatDuration(summary.metrics.oracleDurationMs)} oracle</div>
              <div style={mutedStyle}>Run {summary.metadata.runId.slice(0, 8)}</div>
            </> : <div style={{ ...mutedStyle, marginTop: 8 }}>Run non disponibile per questo task/filtro.</div>}
          </section>
        );
      })}
    </div>
  );
}

export const AnalyticsView: React.FC<Props> = ({ onReplay }) => {
  const [scope, setScope] = useState<Scope>('GLOBAL');
  const [category, setCategory] = useState<'ALL' | ExperimentCategory>('ALL');
  const [modelName, setModelName] = useState('ALL');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [summary, setSummary] = useState<AggregatedMetricsReport | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ baseline: RunSummary | null; multiAgent: RunSummary | null } | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDescending, setSortDescending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API_BASE}/analytics/history`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Impossibile caricare i modelli archiviati.');
        return response.json() as Promise<RunSummary[]>;
      })
      .then((runs) => setAvailableModels([...new Set(runs.map((run) => run.metadata.modelName))].sort()));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = buildFilterQuery(category, modelName);
    setLoading(true);
    setError(null);
    void Promise.all([
      fetch(`${API_BASE}/analytics/summary${query}`, { signal: controller.signal }),
      fetch(`${API_BASE}/analytics/history${query}`, { signal: controller.signal })
    ]).then(async ([summaryResponse, historyResponse]) => {
      if (!summaryResponse.ok || !historyResponse.ok) throw new Error('Errore nel caricamento degli analytics.');
      const [nextSummary, nextHistory] = await Promise.all([
        summaryResponse.json() as Promise<AggregatedMetricsReport>,
        historyResponse.json() as Promise<RunSummary[]>
      ]);
      setSummary(nextSummary);
      setHistory(nextHistory);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError(reason instanceof Error ? reason.message : 'Errore analytics sconosciuto.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [category, modelName]);

  const availableTasks = useMemo(() => [...new Set(history.map((run) => run.metadata.taskId))].sort(), [history]);
  useEffect(() => {
    if (availableTasks.length > 0 && !availableTasks.includes(selectedTaskId)) {
      setSelectedTaskId(availableTasks[0] ?? '');
    }
  }, [availableTasks, selectedTaskId]);

  useEffect(() => {
    if (scope !== 'PAIRED' || !selectedTaskId) {
      setComparison(null);
      return;
    }
    const controller = new AbortController();
    const query = buildFilterQuery(category, modelName);
    void fetch(`${API_BASE}/analytics/compare/${encodeURIComponent(selectedTaskId)}${query}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return { baseline: null, multiAgent: null };
        if (!response.ok) throw new Error('Impossibile caricare il confronto accoppiato.');
        return response.json() as Promise<{ baseline: RunSummary | null; multiAgent: RunSummary | null }>;
      })
      .then(setComparison)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Errore confronto task.');
      });
    return () => controller.abort();
  }, [scope, selectedTaskId, category, modelName]);

  const sortedHistory = useMemo(() => [...history].sort((left, right) => {
    let difference = 0;
    if (sortKey === 'timestamp') difference = left.metadata.timestamp.localeCompare(right.metadata.timestamp);
    if (sortKey === 'taskId') difference = left.metadata.taskId.localeCompare(right.metadata.taskId);
    if (sortKey === 'totalTokens') difference = left.metrics.totalTokens - right.metrics.totalTokens;
    if (sortKey === 'overhead') difference = (left.metrics.endToEndOverheadPct ?? -1) - (right.metrics.endToEndOverheadPct ?? -1);
    return sortDescending ? -difference : difference;
  }), [history, sortDescending, sortKey]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) setSortDescending((value) => !value);
    else {
      setSortKey(key);
      setSortDescending(true);
    }
  };

  const replay = async (runId: string) => {
    try {
      const response = await fetch(`${API_BASE}/experiments/${encodeURIComponent(runId)}`);
      if (!response.ok) throw new Error('Impossibile caricare il run per il replay.');
      onReplay(await response.json() as StoredRun);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Errore durante il replay.');
    }
  };

  const baselineRate = summary?.modes.BASELINE.successRatePct ?? null;
  const multiRate = summary?.modes.MULTI_AGENT.successRatePct ?? null;
  const successDelta = baselineRate === null || multiRate === null ? null : multiRate - baselineRate;
  const baselineEndToEndOverhead = summary?.modes.BASELINE.averageEndToEndOverheadPct ?? null;
  const overheadAverage = summary?.modes.MULTI_AGENT.averageEndToEndOverheadPct ?? null;
  const baselineActiveFrameworkOverhead = summary?.modes.BASELINE.averageActiveFrameworkOverheadPct ?? null;
  const activeFrameworkOverhead = summary?.modes.MULTI_AGENT.averageActiveFrameworkOverheadPct ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f3f3f3' }}>Research Analytics</h2>
          <div style={{ ...mutedStyle, marginTop: 4 }}>Metriche calcolate dagli artefatti sperimentali persistiti</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={mutedStyle}>Categoria
            <select value={category} onChange={(event) => setCategory(event.target.value as 'ALL' | ExperimentCategory)} style={{ marginLeft: 6, background: '#1e1e1e', color: '#ddd', border: '1px solid #555', padding: 6 }}>
              <option value="ALL">Tutte</option><option value="REPAIR">REPAIR</option><option value="CREATE">CREATE</option>
            </select>
          </label>
          <label style={mutedStyle}>Modello
            <select value={modelName} onChange={(event) => setModelName(event.target.value)} style={{ marginLeft: 6, background: '#1e1e1e', color: '#ddd', border: '1px solid #555', padding: 6 }}>
              <option value="ALL">Tutti</option>{availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #444', paddingBottom: 8 }}>
        <button onClick={() => setScope('GLOBAL')} aria-pressed={scope === 'GLOBAL'} style={scopeButtonStyle(scope === 'GLOBAL')}><BarChart3 size={15} /> Suite Aggregata</button>
        <button onClick={() => setScope('PAIRED')} aria-pressed={scope === 'PAIRED'} style={scopeButtonStyle(scope === 'PAIRED')}><GitCompareArrows size={15} /> Confronto Paired Task</button>
      </div>

      {scope === 'PAIRED' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label htmlFor="paired-task" style={mutedStyle}>Task</label>
          <select id="paired-task" value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)} style={{ minWidth: 280, maxWidth: '100%', background: '#1e1e1e', color: '#ddd', border: '1px solid #555', padding: 7 }}>
            {availableTasks.map((taskId) => <option key={taskId} value={taskId}>{taskId}</option>)}
          </select>
        </div>
      )}

      {error && <div role="alert" style={{ ...panelStyle, color: '#f48771' }}>{error}</div>}
      {loading && <div style={mutedStyle}>Caricamento run persistiti...</div>}

      {scope === 'PAIRED' && <PairedCard baseline={comparison?.baseline ?? null} multiAgent={comparison?.multiAgent ?? null} />}

      {summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <Kpi label="Success Rate" value={`B ${formatPercent(baselineRate)} · M ${formatPercent(multiRate)}`} detail={`Delta Multi-Agent ${successDelta === null ? 'n/d' : `${successDelta >= 0 ? '+' : ''}${successDelta.toFixed(1)} pp`}`} accent="#56a6d8" />
            <Kpi label="Autonomous Recovery Rate" value={formatPercent(summary.autonomousRecoveryRatePct)} detail={`${summary.baselineFailuresInPairs} baseline failures in paired runs`} accent="#d4ad55" />
            <Kpi label="Overhead end-to-end (RNF-05)" value={`B ${formatPercent(baselineEndToEndOverhead)} · M ${formatPercent(overheadAverage)}`} detail={overheadAverage !== null && overheadAverage <= 5 ? 'Multi-Agent conforme (<= 5%)' : 'Confrontato con T_exec wall-clock'} accent={overheadAverage !== null && overheadAverage <= 5 ? '#68b17e' : '#d17857'} />
            <Kpi label="CPU / tempo framework attivo" value={`B ${formatPercent(baselineActiveFrameworkOverhead)} · M ${formatPercent(activeFrameworkOverhead)}`} detail="Baseline vs Multi-Agent · attese LLM/oracle escluse" accent="#d4ad55" />
            <Kpi label="Token per Fix" value={formatNumber(summary.averageTokenToFix)} detail="Media token dei run verificati" accent="#90b2a1" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 12 }}>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Token footprint per task</h3>
              <div style={legendStyle}><span style={{ color: '#4b99c7' }}>Coder prompt</span><span style={{ color: '#9aaed5' }}>Coder completion</span><span style={{ color: '#b26d53' }}>Reviewer prompt</span><span style={{ color: '#d59b7e' }}>Reviewer completion</span></div>
              <TokenChart pairs={summary.pairedTasks} />
            </section>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Durata inferenza e oracle (ms)</h3>
              <LatencyChart report={summary} />
            </section>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Overhead end-to-end · soglia RNF-05</h3>
              <OverheadGauge baselineValue={baselineEndToEndOverhead} multiAgentValue={overheadAverage} metric="END_TO_END" />
              <h3 style={{ ...chartTitleStyle, marginTop: 18 }}>CPU / tempo framework attivo · diagnostica</h3>
              <OverheadGauge baselineValue={baselineActiveFrameworkOverhead} multiAgentValue={activeFrameworkOverhead} metric="ACTIVE_FRAMEWORK" />
            </section>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Churn e SAST residuo per task</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead><tr><th>Task</th><th>Modalità</th><th>+ linee</th><th>- linee</th><th>SAST</th><th>Error</th><th>Warning</th></tr></thead>
                  <tbody>{summary.pairedTasks.flatMap((pair) => [pair.baseline, pair.multiAgent].map((run) => (
                    <tr key={run.metadata.runId}>
                      <td>{run.metadata.taskId}</td><td>{run.metadata.mode}</td><td>{run.metrics.addedLines}</td><td>{run.metrics.deletedLines}</td><td>{run.metrics.residualSastCount}</td><td>{run.metrics.sastErrors}</td><td>{run.metrics.sastWarnings}</td>
                    </tr>
                  )))}</tbody>
                </table>
              </div>
            </section>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Cicli di arresto</h3>
              <table style={tableStyle}>
                <thead><tr><th>Modalità</th><th>n=1</th><th>n=2</th><th>n=3</th><th>Nmax</th></tr></thead>
                <tbody>{(['BASELINE', 'MULTI_AGENT'] as const).map((mode) => (
                  <tr key={mode}>
                    <td>{mode}</td>
                    <td>{summary.modes[mode].convergenceDistribution['1']}</td>
                    <td>{summary.modes[mode].convergenceDistribution['2']}</td>
                    <td>{summary.modes[mode].convergenceDistribution['3']}</td>
                    <td>{summary.modes[mode].convergenceDistribution.N_MAX}</td>
                  </tr>
                ))}</tbody>
              </table>
            </section>
          </div>

          <section style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <h3 style={chartTitleStyle}>Sessioni archiviate ({history.length})</h3>
              <span style={mutedStyle}><Clock3 size={13} style={{ verticalAlign: 'middle' }} /> Tutti i tempi in ms nei JSON raw</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead><tr>
                  <SortHeader label="Timestamp" active={sortKey === 'timestamp'} onClick={() => setSort('timestamp')} />
                  <SortHeader label="Task ID" active={sortKey === 'taskId'} onClick={() => setSort('taskId')} />
                  <th>Categoria</th><th>Modello</th><th>Modalità</th><th>Esito</th><th>n</th><th>Test pass</th><th>Applicabile</th><th>Fuzzy</th><th title="Righe di contesto/rimosse del diff che non esistono nel sorgente originale">Allucinazione</th><th>Flapping</th><th>Coder token</th><th>Reviewer token</th>
                  <SortHeader label="Token" active={sortKey === 'totalTokens'} onClick={() => setSort('totalTokens')} />
                  <SortHeader label="Overhead E2E" active={sortKey === 'overhead'} onClick={() => setSort('overhead')} />
                  <th>CPU / attivo</th>
                  <th>Azioni</th>
                </tr></thead>
                <tbody>
                  {sortedHistory.map((run) => (
                    <tr key={run.metadata.runId}>
                      <td>{new Date(run.metadata.timestamp).toLocaleString()}</td>
                      <td>{run.metadata.taskId}</td><td>{run.metadata.category}</td><td>{run.metadata.modelName}</td><td>{run.metadata.mode}</td>
                      <td style={{ color: run.metrics.resolutionVerified ? '#76c28a' : '#e28b74' }}>{run.metadata.status}</td>
                      <td>{run.metadata.totalIterations}</td>
                      <td>{formatPercent(run.metrics.testPassRatePct)}</td>
                      <td>{run.metrics.allPatchesApplicable ? 'Sì' : 'No'}</td>
                      <td>{run.metrics.fuzzyFallbackUsed ? 'Sì' : 'No'}</td>
                      <td title={`${run.metrics.patchGrounding.ungroundedLines}/${run.metrics.patchGrounding.oldSideLines} righe, ${run.metrics.patchGrounding.ungroundedHunks}/${run.metrics.patchGrounding.hunks} hunk non ancorati`}>{formatPercent(run.metrics.hallucinationRatePct)}</td>
                      <td>{run.metrics.patchFlappingDetected ? 'Sì' : 'No'}</td>
                      <td>{(run.metrics.coderPromptTokens + run.metrics.coderCompletionTokens).toLocaleString()}</td>
                      <td>{(run.metrics.reviewerPromptTokens + run.metrics.reviewerCompletionTokens).toLocaleString()}</td>
                      <td>{run.metrics.totalTokens.toLocaleString()}</td><td>{formatPercent(run.metrics.endToEndOverheadPct)}</td><td>{formatPercent(run.metrics.activeFrameworkOverheadPct)}</td>
                      <td><button onClick={() => void replay(run.metadata.runId)} style={replayButtonStyle}><Play size={13} /> Replay</button></td>
                    </tr>
                  ))}
                  {sortedHistory.length === 0 && <tr><td colSpan={18} style={mutedStyle}>Nessun run salvato per i filtri selezionati.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <div style={mutedStyle}>Run totali: {summary.totalRuns} · Media oracle: {formatNullableDuration(summary.averageOracleDurationMs)} · Churn medio per run: {formatNumber(summary.averageCodeChurnLines)} righe · Human Override: {formatPercent(summary.humanOverrideRatePct)} · Allucinazione contesto (righe) Baseline: {formatPercent(summary.modes.BASELINE.hallucinationRatePct)} · Multi-Agent: {formatPercent(summary.modes.MULTI_AGENT.hallucinationRatePct)}</div>
        </>
      )}
    </div>
  );
};

function scopeButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px', cursor: 'pointer',
    border: `1px solid ${active ? '#4a9fd2' : '#444'}`, borderRadius: 3,
    color: active ? '#d9effb' : '#aaa', background: active ? '#183346' : 'transparent'
  };
}

function SortHeader({ label, active, onClick }: { readonly label: string; readonly active: boolean; readonly onClick: () => void }): React.JSX.Element {
  return <th><button onClick={onClick} style={{ border: 0, background: 'transparent', color: '#c8c8c8', cursor: 'pointer', padding: 0 }}>{label} <ArrowDownUp size={11} style={{ verticalAlign: 'middle', opacity: active ? 1 : 0.45 }} /></button></th>;
}

const chartTitleStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: 14, color: '#eee' };
const legendStyle: React.CSSProperties = { display: 'flex', gap: 12, ...mutedStyle, marginBottom: 6 };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 };
const replayButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#234b36', color: '#d4f0dc', border: '1px solid #467654', borderRadius: 3, padding: '5px 8px', cursor: 'pointer' };
