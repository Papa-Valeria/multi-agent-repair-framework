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
type SortKey = 'timestamp' | 'taskId' | 'totalTokens';
const HISTORY_COLUMNS = [
  'timestamp',
  'taskId',
  'category',
  'modelName',
  'mode',
  'autonomousOutcome',
  'finalization',
  'provenance',
  'iterations',
  'testPass',
  'applicable',
  'fuzzy',
  'processUngroundedLines',
  'processUngroundedHunks',
  'finalUngroundedLines',
  'finalUngroundedHunks',
  'flapping',
  'coderTokens',
  'reviewerTokens',
  'totalTokens',
  'actions'
] as const;
const HISTORY_COLUMN_COUNT =
  HISTORY_COLUMNS.length;

interface Props {
  readonly onReplay: (run: StoredRun) => void;
}

const panelStyle: React.CSSProperties = {
  background: '#252526',
  border: '1px solid #3c3c3c',
  borderRadius: 4,
  padding: 16
};

interface ComparableTokenRun {
  readonly totalTokens: number;
  readonly coderPromptTokens: number;
  readonly coderCompletionTokens: number;
  readonly reviewerPromptTokens: number;
  readonly reviewerCompletionTokens: number;
}

interface ComparableTokenPair {
  readonly pairKey: string;
  readonly taskId: string;
  readonly modelName: string;
  readonly baseline: ComparableTokenRun;
  readonly multiAgent: ComparableTokenRun;
}

function toComparableTokenRun(
  run: RunSummary
): ComparableTokenRun | null {
  const metrics = run.metrics;

  if (
    !run.comparability.agentUsageObserved ||
    !metrics.tokenUsageAvailable ||
    metrics.totalTokens === null ||
    !metrics.coderTokenUsageAvailable ||
    metrics.coderPromptTokens === null ||
    metrics.coderCompletionTokens === null ||
    !metrics.reviewerTokenUsageAvailable ||
    metrics.reviewerPromptTokens === null ||
    metrics.reviewerCompletionTokens === null
  ) {
    return null;
  }

  return {
    totalTokens: metrics.totalTokens,
    coderPromptTokens:
      metrics.coderPromptTokens,
    coderCompletionTokens:
      metrics.coderCompletionTokens,
    reviewerPromptTokens:
      metrics.reviewerPromptTokens,
    reviewerCompletionTokens:
      metrics.reviewerCompletionTokens
  };
}

function toComparableTokenPair(
  pair: AggregatedMetricsReport['pairedTasks'][number]
): ComparableTokenPair | null {
  const baseline = toComparableTokenRun(
    pair.baseline
  );
  const multiAgent = toComparableTokenRun(
    pair.multiAgent
  );

  if (
    baseline === null ||
    multiAgent === null
  ) {
    return null;
  }

  return {
    pairKey: pair.pairKey,
    taskId: pair.taskId,
    modelName: pair.modelName,
    baseline,
    multiAgent
  };
}

const mutedStyle: React.CSSProperties = { color: '#9da0a5', fontSize: 12 };

function formatPercent(value: number | null): string {
  return value === null ? 'n/d' : `${value.toFixed(1)}%`;
}

function formatRatio(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`;
}

function formatNullableInteger(value: number | null): string {
  return value === null ? 'n/d' : Math.round(value).toLocaleString();
}

function sumObservedTokenPair(
  available: boolean,
  promptTokens: number | null,
  completionTokens: number | null
): number | null {
  if (
    !available ||
    promptTokens === null ||
    completionTokens === null
  ) {
    return null;
  }

  return promptTokens + completionTokens;
}

function getObservedTotalTokens(
  run: RunSummary
): number | null {
  return (
    run.metrics.tokenUsageAvailable &&
      run.metrics.totalTokens !== null
      ? run.metrics.totalTokens
      : null
  );
}

function getComparableOracleDuration(
  run: RunSummary
): number | null {
  return (
    run.metrics.oracleDurationComparable &&
      run.metrics.oracleDurationMs !== null
      ? run.metrics.oracleDurationMs
      : null
  );
}

function compareNullableNumbers(
  left: number | null,
  right: number | null
): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return -1;
  }

  if (right === null) {
    return 1;
  }

  return left - right;
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

function ConvergenceKpi({
  label,
  baselineRate,
  baselineNumerator,
  baselineDenominator,
  multiAgentRate,
  multiAgentNumerator,
  multiAgentDenominator,
  detail,
  accent
}: {
  readonly label: string;
  readonly baselineRate: number | null;
  readonly baselineNumerator: number;
  readonly baselineDenominator: number;
  readonly multiAgentRate: number | null;
  readonly multiAgentNumerator: number;
  readonly multiAgentDenominator: number;
  readonly detail: string;
  readonly accent: string;
}): React.JSX.Element {
  return (
    <section
      style={{
        ...panelStyle,
        borderTop: `2px solid ${accent}`,
        minWidth: 0
      }}
    >
      <div style={mutedStyle}>
        {label}
      </div>

      <div
        style={{
          color: '#f2f2f2',
          fontSize: 22,
          fontWeight: 650,
          marginTop: 8
        }}
      >
        B {formatPercent(baselineRate)} ·{' '}
        M {formatPercent(multiAgentRate)}
      </div>

      <div
        style={{
          color: '#c8ccd2',
          fontFamily: 'monospace',
          fontSize: 12,
          marginTop: 6
        }}
      >
        B {formatRatio(
          baselineNumerator,
          baselineDenominator
        )}{' · '}
        M {formatRatio(
          multiAgentNumerator,
          multiAgentDenominator
        )}
      </div>

      <div
        style={{
          ...mutedStyle,
          marginTop: 5
        }}
      >
        {detail}
      </div>
    </section>
  );
}

function GroundingRateCell({
  rate,
  numerator,
  denominator,
  scope,
  unit
}: {
  readonly rate: number | null;
  readonly numerator: number;
  readonly denominator: number;
  readonly scope: 'PROCESS' | 'FINAL';
  readonly unit: 'OLD-SIDE LINES' | 'HUNKS';
}): React.JSX.Element {
  return (
    <td
      title={
        `${scope} · ${unit}: ` +
        `${numerator}/${denominator} ungrounded`
      }
    >
      {formatPercent(rate)}{' '}
      <span style={mutedStyle}>
        ({numerator}/{denominator})
      </span>
    </td>
  );
}

function formatRunProvenance(
  isHumanAugmented: boolean
): string {
  return isHumanAugmented
    ? 'HUMAN-AUGMENTED'
    : 'AUTONOMOUS';
}

function autonomousOutcomeColor(
  status: RunSummary['metadata']['autonomousStatus']
): string {
  switch (status) {
    case 'CONVERGED':
      return '#4ec9b0';
    case 'UNRESOLVED':
      return '#d4ad55';
    case 'FAILED':
      return '#f48771';
    case 'INFRASTRUCTURE_ERROR':
      return '#d16969';
  }
}

function finalizationStatusColor(
  status: RunSummary['metadata']['finalizationStatus']
): string {
  switch (status) {
    case 'NOT_FINALIZED':
      return '#9d9d9d';
    case 'APPROVED':
      return '#4ec9b0';
    case 'REJECTED':
      return '#f48771';
  }
}

const TOKEN_CHART_COLORS = {
  baseline: {
    coderPrompt: '#276c9b',
    coderCompletion: '#4b99c7',
    reviewerPrompt: '#687eac',
    reviewerCompletion: '#9aaed5'
  },
  multiAgent: {
    coderPrompt: '#9b641b',
    coderCompletion: '#c38c39',
    reviewerPrompt: '#b26d53',
    reviewerCompletion: '#d59b7e'
  }
} as const;

function TokenLegendItem({
  color,
  label
}: {
  readonly color: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        color: '#c8ccd2'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          display: 'inline-block',
          flex: '0 0 auto'
        }}
      />
      {label}
    </span>
  );
}

function TokenChart({ pairs }: { readonly pairs: AggregatedMetricsReport['pairedTasks'] }): React.JSX.Element {
  const comparablePairs = pairs.map(toComparableTokenPair).filter((pair): pair is ComparableTokenPair => pair !== null);
  const comparableKeys = new Set(comparablePairs.map((pair) => pair.pairKey));
  const excludedPairs = pairs.filter((pair) => !comparableKeys.has(pair.pairKey));
  const excludedPairCount = excludedPairs.length;


  if (pairs.length === 0) {
    return (
      <div style={mutedStyle}>
        Servono run accoppiati per visualizzare il confronto.
      </div>
    );
  }

  if (comparablePairs.length === 0) {
    return (
      <div>
        <div style={mutedStyle}>
          Token usage agent-level non comparabile.
          {' '}
          Coppie comparabili: 0/{pairs.length}
          {' · '}
          Escluse: {excludedPairCount}
        </div>

        <div style={{ ...mutedStyle, marginTop: 4 }}>
          Escluse per agent usage non osservato/incompleto:{' '}
          {excludedPairs
            .slice(0, 5)
            .map((pair) => pair.taskId)
            .join(', ')}
          {excludedPairs.length > 5
            ? ` +${excludedPairs.length - 5}`
            : ''}
        </div>
      </div>
    );
  }


  const observedTotals = comparablePairs.flatMap(
    (pair) => [
      pair.baseline.totalTokens,
      pair.multiAgent.totalTokens
    ]
  );

  const maxTokens = Math.max(1, ...observedTotals);
  const height = Math.max(115, comparablePairs.length * 46 + 36);

  return (
    <div>
      <div
        aria-label="Token chart legend"
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(190px, 1fr))',
          gap: '6px 12px',
          marginBottom: 10,
          fontSize: 11
        }}
      >
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.baseline.coderPrompt}
          label="Baseline · Coder prompt"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.baseline.coderCompletion}
          label="Baseline · Coder completion"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.baseline.reviewerPrompt}
          label="Baseline · Reviewer prompt"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.baseline.reviewerCompletion}
          label="Baseline · Reviewer completion"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.multiAgent.coderPrompt}
          label="Multi-Agent · Coder prompt"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.multiAgent.coderCompletion}
          label="Multi-Agent · Coder completion"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.multiAgent.reviewerPrompt}
          label="Multi-Agent · Reviewer prompt"
        />
        <TokenLegendItem
          color={TOKEN_CHART_COLORS.multiAgent.reviewerCompletion}
          label="Multi-Agent · Reviewer completion"
        />
      </div>
      <svg viewBox={`0 0 860 ${height}`} role="img" aria-label="Token footprint per task" style={{ width: '100%', display: 'block' }}>
        {comparablePairs.map((pair, index) => {
          const baseline = pair.baseline;
          const multi = pair.multiAgent;
          const y = 24 + index * 46;
          const baselineCoderPrompt = (baseline.coderPromptTokens / maxTokens) * 390;
          const baselineCoderCompletion = (baseline.coderCompletionTokens / maxTokens) * 390;
          const baselineReviewerPrompt = (baseline.reviewerPromptTokens / maxTokens) * 390;
          const baselineReviewerCompletion = (baseline.reviewerCompletionTokens / maxTokens) * 390;
          const multiCoderPrompt = (multi.coderPromptTokens / maxTokens) * 390;
          const multiCoderCompletion = (multi.coderCompletionTokens / maxTokens) * 390;
          const multiReviewerPrompt = (multi.reviewerPromptTokens / maxTokens) * 390;
          const multiReviewerCompletion = (multi.reviewerCompletionTokens / maxTokens) * 390;

          return (
            <g key={pair.pairKey}>
              <text x="8" y={y + 11} fill="#d6d6d6" fontSize="11">{pair.taskId.slice(0, 20)}</text>
              <rect x="170" y={y} width={baselineCoderPrompt} height="12" fill={TOKEN_CHART_COLORS.baseline.coderPrompt} />
              <rect x={170 + baselineCoderPrompt} y={y} width={baselineCoderCompletion} height="12" fill={TOKEN_CHART_COLORS.baseline.coderCompletion} />
              <rect x={170 + baselineCoderPrompt + baselineCoderCompletion} y={y} width={baselineReviewerPrompt} height="12" fill={TOKEN_CHART_COLORS.baseline.reviewerPrompt} />
              <rect x={170 + baselineCoderPrompt + baselineCoderCompletion + baselineReviewerPrompt} y={y} width={baselineReviewerCompletion} height="12" fill={TOKEN_CHART_COLORS.baseline.reviewerCompletion} />
              <text x="570" y={y + 10} fill="#a9d8f4" fontSize="11">Baseline {baseline.totalTokens.toLocaleString()}</text>
              <rect x="170" y={y + 17} width={multiCoderPrompt} height="12" fill={TOKEN_CHART_COLORS.multiAgent.coderPrompt} />
              <rect x={170 + multiCoderPrompt} y={y + 17} width={multiCoderCompletion} height="12" fill={TOKEN_CHART_COLORS.multiAgent.coderCompletion} />
              <rect x={170 + multiCoderPrompt + multiCoderCompletion} y={y + 17} width={multiReviewerPrompt} height="12" fill={TOKEN_CHART_COLORS.multiAgent.reviewerPrompt} />
              <rect x={170 + multiCoderPrompt + multiCoderCompletion + multiReviewerPrompt} y={y + 17} width={multiReviewerCompletion} height="12" fill={TOKEN_CHART_COLORS.multiAgent.reviewerCompletion} />
              <text x="570" y={y + 27} fill="#f3d99c" fontSize="11">Multi-Agent {multi.totalTokens.toLocaleString()}</text>
            </g>
          );
        })}
      </svg>
      <div style={mutedStyle}>
        Coppie comparabili:{' '}
        {comparablePairs.length}/{pairs.length}
        {' · '}
        Escluse: {excludedPairCount}
      </div>
      {excludedPairs.length > 0 && (
        <div style={{ ...mutedStyle, marginTop: 4 }}>
          Escluse per agent usage non osservato/incompleto:{' '}
          {excludedPairs
            .slice(0, 5)
            .map((pair) => pair.taskId)
            .join(', ')}
          {excludedPairs.length > 5
            ? ` +${excludedPairs.length - 5}`
            : ''}
        </div>
      )}
    </div>
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

  const observedDurations = modes.flatMap(({ key }) => {
    const metric = report.modes[key];
    const values: number[] = [];

    if (metric.averageInferenceDurationMs !== null) {
      values.push(metric.averageInferenceDurationMs
      );
    }

    if (metric.averageOracleDurationMs !== null) {
      values.push(metric.averageOracleDurationMs);
    }

    return values;
  });

  if (observedDurations.length === 0) {
    return (
      <div style={mutedStyle}>
        Durate non disponibili.
      </div>
    );
  }

  const maxDuration = Math.max(1, ...observedDurations);

  return (
    <svg viewBox="0 0 720 150" role="img" aria-label="Latenza LLM e oracle" style={{ width: '100%', display: 'block' }}>
      {modes.map(({ key, label, color }, index) => {
        const metric = report.modes[key];
        const y = 24 + index * 57;
        const oracleComparableCount = metric.oracleDurationComparableRunCount;
        const oracleExcludedCount = metric.oracleDurationExcludedLegacyRunCount;
        const inferenceWidth = metric.averageInferenceDurationMs === null ? null
          : (metric.averageInferenceDurationMs / maxDuration) * 420;
        const oracleWidth = metric.averageOracleDurationMs === null ? null : (metric.averageOracleDurationMs / maxDuration) * 420;
        const oracleX = 120 + (inferenceWidth ?? 0);

        return (
          <g key={key}>
            <text x="8" y={y + 12} fill="#d6d6d6" fontSize="12">{label}</text>
            {inferenceWidth !== null && (
              <rect x="120" y={y} width={inferenceWidth} height="22" fill={color} />
            )}
            {oracleWidth !== null && (
              <rect x={oracleX} y={y} width={oracleWidth} height="22" fill="#72a77c" />
            )}
            <text x="565" y={y + 14} fill="#d6d6d6" fontSize="11">
              LLM {formatNullableDuration(metric.averageInferenceDurationMs)} / oracle {formatNullableDuration(metric.averageOracleDurationMs)}
            </text>
            <text x="565" y={y + 27} fill="#9da0a5" fontSize="10">
              Oracle comparable {oracleComparableCount}{' · '}excluded legacy {oracleExcludedCount}
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
              <div style={{ marginTop: 8 }}>
                <span style={mutedStyle}>
                  Autonomous:{' '}
                </span>
                <strong
                  style={{
                    color: autonomousOutcomeColor(
                      summary.metadata.autonomousStatus
                    )
                  }}
                >
                  {summary.metadata.autonomousStatus}
                </strong>
              </div>

              <div style={mutedStyle}>
                Finalization:{' '}
                <strong
                  style={{
                    color: finalizationStatusColor(
                      summary.metadata.finalizationStatus
                    )
                  }}
                >
                  {summary.metadata.finalizationStatus}
                </strong>
                {' · '}
                {formatRunProvenance(
                  summary.metadata.isHumanAugmented
                )}
              </div>

              <div style={mutedStyle}>
                {summary.metadata.totalIterations} iterazioni
              </div>
              <div style={mutedStyle}>{formatNullableInteger(getObservedTotalTokens(summary))} token · {formatPercent(summary.metrics.testPassRatePct)} test pass</div>
              <div style={mutedStyle}>{summary.metrics.residualSastCount} finding SAST · {formatNullableDuration(getComparableOracleDuration(summary))} oracle comparabile</div>
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
    if (sortKey === 'totalTokens') {
      difference = compareNullableNumbers(getObservedTotalTokens(left), getObservedTotalTokens(right));
    }

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
            <ConvergenceKpi
              label="Raw convergence"
              baselineRate={
                summary.modes.BASELINE
                  .rawConvergenceRatePct
              }
              baselineNumerator={
                summary.modes.BASELINE
                  .rawConvergenceNumerator
              }
              baselineDenominator={
                summary.modes.BASELINE
                  .rawConvergenceDenominator
              }
              multiAgentRate={
                summary.modes.MULTI_AGENT
                  .rawConvergenceRatePct
              }
              multiAgentNumerator={
                summary.modes.MULTI_AGENT
                  .rawConvergenceNumerator
              }
              multiAgentDenominator={
                summary.modes.MULTI_AGENT
                  .rawConvergenceDenominator
              }
              detail="Tutti i run, inclusi quelli invalidi"
              accent="#56a6d8"
            />

            <ConvergenceKpi
              label="Valid-run convergence"
              baselineRate={
                summary.modes.BASELINE
                  .validRunConvergenceRatePct
              }
              baselineNumerator={
                summary.modes.BASELINE
                  .validRunConvergenceNumerator
              }
              baselineDenominator={
                summary.modes.BASELINE
                  .validRunConvergenceDenominator
              }
              multiAgentRate={
                summary.modes.MULTI_AGENT
                  .validRunConvergenceRatePct
              }
              multiAgentNumerator={
                summary.modes.MULTI_AGENT
                  .validRunConvergenceNumerator
              }
              multiAgentDenominator={
                summary.modes.MULTI_AGENT
                  .validRunConvergenceDenominator
              }
              detail={
                `Invalid run: B ${summary.modes.BASELINE.invalidRunCount
                } · M ${summary.modes.MULTI_AGENT.invalidRunCount
                }`
              }
              accent="#68b17e"
            />


            <Kpi
              label="Autonomous Recovery Rate"
              value={formatPercent(
                summary.autonomousRecoveryRatePct
              )}
              detail={
                `Eligible UNRESOLVED pairs: ${summary.autonomousRecoveryEligiblePairs
                } · Excluded infrastructure: ${summary
                  .autonomousRecoveryInfrastructureExcludedPairs
                } · Excluded other failures: ${summary
                  .autonomousRecoveryOtherFailureExcludedPairs
                }`
              }
              accent="#d4ad55"
            />
            <Kpi label="Token per run verificato" value={formatNullableInteger(summary.averageTokensPerVerifiedRun)} detail="Media token dei run verificati" accent="#90b2a1" />
            <Kpi
              label="Avg process churn"
              value={
                formatNullableInteger(
                  summary.averageProcessCodeChurnLines
                )
              }
              detail="Media linee modificate lungo il processo di refinement"
              accent="#b58bd2"
            />
            <Kpi
              label="Avg final churn"
              value={
                formatNullableInteger(
                  summary.averageFinalCodeChurnLines
                )
              }
              detail="Media linee modificate nella patch finale"
              accent="#7ca6d8"
            />

          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: 12 }}>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Token footprint per task</h3>
              <TokenChart pairs={summary.pairedTasks} />
            </section>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Durata inferenza e oracle (ms)</h3>
              <LatencyChart report={summary} />
            </section>
            <section style={panelStyle}>
              <h3 style={chartTitleStyle}>Process vs final churn e SAST residuo per task</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Modalita</th>
                      <th title="Linee aggiunte durante l'intero processo di refinement">
                        Process added
                      </th>
                      <th title="Linee rimosse durante l'intero processo di refinement">
                        Process deleted
                      </th>
                      <th title="Linee aggiunte nella patch finale">
                        Final added
                      </th>
                      <th title="Linee rimosse nella patch finale">
                        Final deleted
                      </th>

                      <th>SAST</th>
                      <th>Error</th>
                      <th>Warning</th>
                    </tr>
                  </thead>
                  <tbody>{summary.pairedTasks.flatMap((pair) => [pair.baseline, pair.multiAgent].map((run) => (
                    <tr key={run.metadata.runId}>
                      <td>{run.metadata.taskId}</td>
                      <td>{run.metadata.mode}</td>
                      <td>{run.metrics.processAddedLines}</td>
                      <td>{run.metrics.processDeletedLines}</td>
                      <td>{run.metrics.finalAddedLines}</td>
                      <td>{run.metrics.finalDeletedLines}</td>
                      <td>{run.metrics.residualSastCount}</td>
                      <td>{run.metrics.sastErrors}</td>
                      <td>{run.metrics.sastWarnings}</td>
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
            <h3 style={chartTitleStyle}>
              Patch grounding per task
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Modalita</th>
                    <th>Process lines</th>
                    <th>Process hunks</th>
                    <th>Final lines</th>
                    <th>Final hunks</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.pairedTasks.flatMap(
                    (pair) =>
                      [
                        pair.baseline,
                        pair.multiAgent
                      ].map((run) => (
                        <tr key={run.metadata.runId}>
                          <td>{run.metadata.taskId}</td>
                          <td>{run.metadata.mode}</td>
                          <GroundingRateCell
                            scope="PROCESS"
                            unit="OLD-SIDE LINES"
                            rate={run.metrics.processUngroundedOldSideLineRatePct}
                            numerator={run.metrics.processPatchGrounding.ungroundedLines}
                            denominator={run.metrics.processPatchGrounding.oldSideLines}
                          />
                          <GroundingRateCell
                            scope="PROCESS"
                            unit="HUNKS"
                            rate={run.metrics.processUngroundedHunkRatePct}
                            numerator={run.metrics.processPatchGrounding.ungroundedHunks}
                            denominator={run.metrics.processPatchGrounding.hunks}
                          />
                          <GroundingRateCell
                            scope="FINAL"
                            unit="OLD-SIDE LINES"
                            rate={run.metrics.finalUngroundedOldSideLineRatePct}
                            numerator={run.metrics.finalPatchGrounding.ungroundedLines}
                            denominator={run.metrics.finalPatchGrounding.oldSideLines}
                          />
                          <GroundingRateCell
                            scope="FINAL"
                            unit="HUNKS"
                            rate={run.metrics.finalUngroundedHunkRatePct}
                            numerator={run.metrics.finalPatchGrounding.ungroundedHunks}
                            denominator={run.metrics.finalPatchGrounding.hunks}
                          />
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
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
                  <th>Categoria</th>
                  <th>Modello</th>
                  <th>Modalità</th>
                  <th>Autonomous outcome</th>
                  <th>Finalization</th>
                  <th>Provenance</th>
                  <th>n</th>
                  <th>Test pass</th>
                  <th>Applicabile</th>
                  <th>Fuzzy</th>
                  <th title="PROCESS · ungrounded old-side lines">
                    Process ungrounded lines
                  </th>
                  <th title="PROCESS · ungrounded hunks">
                    Process ungrounded hunks
                  </th>
                  <th title="FINAL · ungrounded old-side lines">
                    Final ungrounded lines
                  </th>
                  <th title="FINAL · ungrounded hunks">
                    Final ungrounded hunks
                  </th>

                  <th>Flapping</th>
                  <th>Coder token osservati</th>
                  <th>Reviewer token osservati</th>
                  <SortHeader label="Token totali osservati" active={sortKey === 'totalTokens'} onClick={() => setSort('totalTokens')} />
                  <th>Azioni</th>
                </tr></thead>
                <tbody>
                  {sortedHistory.map((run) => (
                    <tr key={run.metadata.runId}>
                      <td>{new Date(run.metadata.timestamp).toLocaleString()}</td>
                      <td>{run.metadata.taskId}</td><td>{run.metadata.category}</td><td>{run.metadata.modelName}</td><td>{run.metadata.mode}</td>
                      <td
                        style={{
                          color: autonomousOutcomeColor(
                            run.metadata.autonomousStatus
                          ),
                          fontWeight: 600
                        }}
                      >
                        {run.metadata.autonomousStatus}
                      </td>

                      <td
                        style={{
                          color: finalizationStatusColor(
                            run.metadata.finalizationStatus
                          ),
                          fontWeight: 600
                        }}
                      >
                        {run.metadata.finalizationStatus}
                      </td>

                      <td
                        style={{
                          color: run.metadata.isHumanAugmented
                            ? '#c586c0'
                            : '#9da0a5',
                          fontWeight: run.metadata.isHumanAugmented
                            ? 600
                            : 400
                        }}
                      >
                        {formatRunProvenance(
                          run.metadata.isHumanAugmented
                        )}
                      </td>
                      <td>{run.metadata.totalIterations}</td>
                      <td>{formatPercent(run.metrics.testPassRatePct)}</td>
                      <td>{run.metrics.allPatchesApplicable ? 'Sì' : 'No'}</td>
                      <td>{run.metrics.fuzzyFallbackUsed ? 'Sì' : 'No'}</td>
                      <GroundingRateCell
                        scope="PROCESS"
                        unit="OLD-SIDE LINES"
                        rate={
                          run.metrics
                            .processUngroundedOldSideLineRatePct
                        }
                        numerator={
                          run.metrics
                            .processPatchGrounding.ungroundedLines
                        }
                        denominator={
                          run.metrics
                            .processPatchGrounding.oldSideLines
                        }
                      />

                      <GroundingRateCell
                        scope="PROCESS"
                        unit="HUNKS"
                        rate={
                          run.metrics.processUngroundedHunkRatePct
                        }
                        numerator={
                          run.metrics
                            .processPatchGrounding.ungroundedHunks
                        }
                        denominator={
                          run.metrics.processPatchGrounding.hunks
                        }
                      />

                      <GroundingRateCell
                        scope="FINAL"
                        unit="OLD-SIDE LINES"
                        rate={
                          run.metrics
                            .finalUngroundedOldSideLineRatePct
                        }
                        numerator={
                          run.metrics
                            .finalPatchGrounding.ungroundedLines
                        }
                        denominator={
                          run.metrics
                            .finalPatchGrounding.oldSideLines
                        }
                      />

                      <GroundingRateCell
                        scope="FINAL"
                        unit="HUNKS"
                        rate={
                          run.metrics.finalUngroundedHunkRatePct
                        }
                        numerator={
                          run.metrics
                            .finalPatchGrounding.ungroundedHunks
                        }
                        denominator={
                          run.metrics.finalPatchGrounding.hunks
                        }
                      />
                      <td>{run.metrics.patchFlappingDetected ? 'Sì' : 'No'}</td>
                      <td>{formatNullableInteger(
                        run.comparability.agentUsageObserved
                          ? sumObservedTokenPair(
                            run.metrics
                              .coderTokenUsageAvailable,
                            run.metrics.coderPromptTokens,
                            run.metrics.coderCompletionTokens
                          )
                          : null
                      )}</td>
                      <td>{formatNullableInteger(
                        run.comparability.agentUsageObserved
                          ? sumObservedTokenPair(
                            run.metrics
                              .reviewerTokenUsageAvailable,
                            run.metrics.reviewerPromptTokens,
                            run.metrics
                              .reviewerCompletionTokens
                          )
                          : null
                      )
                      }</td>
                      <td>{formatNullableInteger(getObservedTotalTokens(run))}</td>
                      <td><button onClick={() => void replay(run.metadata.runId)} style={replayButtonStyle}><Play size={13} /> Replay</button></td>
                    </tr>
                  ))}
                  {sortedHistory.length === 0 && (
                    <tr>
                      <td
                        colSpan={HISTORY_COLUMN_COUNT}
                        style={mutedStyle}
                      >
                        Nessun run salvato per i filtri selezionati.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div style={mutedStyle}>
            Run totali: {summary.totalRuns}
            {' · '}
            Media oracle:{' '}
            {formatNullableDuration(
              summary.averageOracleDurationMs
            )}{' '}
            <span>
              (comparable{' '}
              {summary.oracleDurationComparableRunCount}
              {' · '}
              excluded legacy{' '}
              {summary.oracleDurationExcludedLegacyRunCount})
            </span>
            {' · '}
            Human Override:{' '}
            {formatPercent(
              summary.humanOverrideRatePct
            )}
          </div>
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
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 };
const replayButtonStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, background: '#234b36', color: '#d4f0dc', border: '1px solid #467654', borderRadius: 3, padding: '5px 8px', cursor: 'pointer' };
