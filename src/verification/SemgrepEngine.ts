import { ProcessRunner } from './ProcessRunner.js';
import { DiffScoper } from './DiffScoper.js';
import { SastFinding } from '../types/domain.js';
import { ExperimentCategory } from '../types/analytics.js';

interface RawSemgrepOutput {
  readonly errors?: ReadonlyArray<{ readonly message?: string }>;
  readonly results?: ReadonlyArray<{
    readonly check_id: string;
    readonly path: string;
    readonly start: { readonly line: number };
    readonly end: { readonly line: number };
    readonly extra?: {
      readonly severity?: string;
      readonly message?: string;
      readonly metadata?: {
        readonly cwe?: string | readonly string[];
        readonly 'owasp-top-ten'?: string;
      };
    };
  }>;
}

export class SemgrepEngine {
  public lastScanDurationMs = 0;

  constructor(private readonly repoRoot: string) { }

  public async scan(
    targetFiles: readonly string[],
    patchDiff: string,
    category: ExperimentCategory = 'REPAIR'
  ): Promise<readonly SastFinding[]> {
    this.lastScanDurationMs = 0;

    if (targetFiles.length === 0) {
      throw new Error('Semgrep non può verificare una patch senza file target.');
    }

    const args = [
      'scan',
      '--config=auto',
      '--config=p/owasp-top-ten',
      '--config=p/security-audit',
      '--config=p/cwe-top-25',
      '--config=p/python',
      '--json',
      ...targetFiles
    ];

    const result = await ProcessRunner.execute('semgrep', args, this.repoRoot, 60000);
    this.lastScanDurationMs = result.durationMs;

    if (result.timedOut) {
      throw new Error('Semgrep ha superato il timeout di 60 secondi.');
    }

    if (result.executionError) {
      throw new Error(`Impossibile eseguire Semgrep: ${result.executionError}`);
    }

    if (!result.stdout.trim()) {
      throw new Error(
        `Semgrep non ha prodotto un report JSON (exit code ${result.exitCode ?? 'null'}). ${result.stderr}`.trim()
      );
    }

    let parsed: RawSemgrepOutput;
    try {
      parsed = JSON.parse(result.stdout) as RawSemgrepOutput;
    } catch {
      throw new Error(`Parsing fallito per l'output JSON di Semgrep: ${result.stderr}`);
    }

    if (!Array.isArray(parsed.results)) {
      throw new Error("Il report JSON di Semgrep non contiene l'array 'results' atteso.");
    }

    if (parsed.errors && parsed.errors.length > 0) {
      const errMsgs = parsed.errors.map((e) => e.message ?? 'errore sconosciuto').join('; ');
      throw new Error(`Semgrep ha riportato errori nell'esecuzione delle regole: ${errMsgs}`);
    }

    if (result.exitCode !== 0 && !(result.exitCode === 1 && parsed.results.length > 0)) {
      if (parsed.results.length === 0) {
        throw new Error(`Semgrep è terminato con codice ${result.exitCode}: ${result.stderr}`.trim());
      }
    }

    const rawFindings: SastFinding[] = parsed.results.map((item) => {
      const sev = (item.extra?.severity ?? 'WARNING').toUpperCase();
      const mappedSeverity: 'ERROR' | 'WARNING' | 'INFO' =
        sev === 'ERROR' ? 'ERROR' : sev === 'INFO' ? 'INFO' : 'WARNING';

      const rawCwe = item.extra?.metadata?.cwe;
      const cweList: string[] = [];
      if (Array.isArray(rawCwe)) {
        cweList.push(...rawCwe);
      } else if (typeof rawCwe === 'string') {
        cweList.push(rawCwe);
      }

      return {
        ruleId: item.check_id,
        path: item.path,
        startLine: item.start.line,
        endLine: item.end.line,
        severity: mappedSeverity,
        message: item.extra?.message ?? '',
        cweHierarchy: cweList,
        owaspCategory: item.extra?.metadata?.['owasp-top-ten']
      };
    });

    const modifiedRanges = DiffScoper.extractModifiedLineRanges(patchDiff);
    return DiffScoper.filterFindings(rawFindings, modifiedRanges, targetFiles, category);
  }
}
