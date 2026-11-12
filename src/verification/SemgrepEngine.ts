import { parseFileDiffs } from '../git/UnifiedDiff.js';
import type { ExperimentCategory } from '../types/analytics.js';
import type {
  OracleResult,
  SastFinding
} from '../types/domain.js';
import { DiffScoper } from './DiffScoper.js';
import { ProcessRunner } from './ProcessRunner.js';
import type { SemgrepProfile } from './SemgrepProfile.js';

interface RawSemgrepOutput {
  readonly errors?: ReadonlyArray<{
    readonly message?: string;
  }>;

  readonly results?: ReadonlyArray<{
    readonly check_id: string;
    readonly path: string;

    readonly start: {
      readonly line: number;
    };

    readonly end: {
      readonly line: number;
    };

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

export interface SemgrepExecutionConfig {
  readonly command: string;
  readonly timeoutMs: number;
  readonly envAllowList: readonly string[];
}

export interface SemgrepEvaluationParams {
  readonly targetFiles: readonly string[];
  readonly patchDiff: string;
  readonly category: ExperimentCategory;
  readonly required: boolean;
}

export class SemgrepEngine {
  constructor(
    private readonly repoRoot: string,
    private readonly executionConfig: SemgrepExecutionConfig,
    private readonly profile: SemgrepProfile
  ) { }

  public async evaluate(
    params: SemgrepEvaluationParams
  ): Promise<OracleResult<'SEMGREP'>> {
    const {
      targetFiles,
      patchDiff,
      category,
      required
    } = params;

    const startedAt = performance.now();

    let scannedFiles: readonly string[] = [];

    try {
      const filesToScan = this.resolveFilesToScan(
        targetFiles,
        patchDiff,
        category
      );

      scannedFiles = [...filesToScan];

      if (scannedFiles.length === 0) {
        return {
          oracle: 'SEMGREP',
          status: 'NOT_AVAILABLE',
          required,
          durationMs: performance.now() - startedAt,
          summary:
            'Semgrep non dispone di file sorgente da analizzare.',
          evidence: {
            findings: [],
            scannedFiles
          }
        };
      }

      const findings = await this.executeScan(
        scannedFiles,
        patchDiff,
        category
      );

      if (findings.length > 0) {
        return {
          oracle: 'SEMGREP',
          status: 'FAIL',
          required,
          durationMs: performance.now() - startedAt,
          summary: category === 'REPAIR'
            ? `Semgrep ha rilevato ${findings.length} finding rilevanti secondo la policy REPAIR.`
            : `Semgrep ha rilevato ${findings.length} finding nelle aree modificate.`,
          evidence: {
            findings,
            scannedFiles
          }
        };
      }

      return {
        oracle: 'SEMGREP',
        status: 'PASS',
        required,
        durationMs: performance.now() - startedAt,
        summary: category === 'REPAIR'
          ? 'Semgrep non ha rilevato finding rilevanti secondo la policy REPAIR.'
          : 'Semgrep non ha rilevato finding nelle aree modificate.',
        evidence: {
          findings: [],
          scannedFiles
        }
      };
    } catch (error: unknown) {
      const executionError =
        error instanceof Error
          ? error.message
          : String(error);

      return {
        oracle: 'SEMGREP',
        status: 'EXECUTION_ERROR',
        required,
        durationMs: performance.now() - startedAt,
        summary:
          `Semgrep non ha completato correttamente ` +
          `l’esecuzione: ${executionError}`,
        evidence: {
          findings: [],
          scannedFiles,
          executionError
        }
      };
    }
  }

  private async executeScan(
    scannedFiles: readonly string[],
    patchDiff: string,
    category: ExperimentCategory
  ): Promise<readonly SastFinding[]> {
    const {
      command,
      timeoutMs,
      envAllowList
    } = this.executionConfig;

    const configArgs = this.profile.configs.map((config) => `--config=${config}`);
    const args = [
      'scan',
      ...configArgs,
      '--json',
      ...scannedFiles
    ];

    const result = await ProcessRunner.execute(
      command,
      args,
      {
        cwd: this.repoRoot,
        timeoutMs,
        envAllowList
      }
    );

    if (result.timedOut) {
      const terminationDetails = result.executionError
        ? ` ${result.executionError}`
        : '';

      throw new Error(
        `Semgrep ha superato il timeout configurato ` +
        `di ${timeoutMs} ms.${terminationDetails}`
      );
    }

    if (result.executionError) {
      throw new Error(
        `Impossibile avviare o completare Semgrep: ` +
        `${result.executionError}`
      );
    }

    if (result.exitCode === null) {
      throw new Error(
        'Semgrep è terminato senza un exit code valido.'
      );
    }

    if (!result.stdout.trim()) {
      throw new Error(
        (
          `Semgrep non ha prodotto un report JSON ` +
          `(exit code ${result.exitCode}). ` +
          `${result.stderr}`
        ).trim()
      );
    }

    let parsed: RawSemgrepOutput;

    try {
      parsed = JSON.parse(
        result.stdout
      ) as RawSemgrepOutput;
    } catch {
      throw new Error(
        (
          `Parsing fallito per l'output JSON di Semgrep. ` +
          `${result.stderr}`
        ).trim()
      );
    }

    if (!Array.isArray(parsed.results)) {
      throw new Error(
        "Il report JSON di Semgrep non contiene " +
        "l'array 'results' atteso."
      );
    }

    if (
      parsed.errors !== undefined &&
      parsed.errors.length > 0
    ) {
      const errorMessages = parsed.errors
        .map(
          (error) =>
            error.message ?? 'errore sconosciuto'
        )
        .join('; ');

      throw new Error(
        `Semgrep ha riportato errori ` +
        `nell'esecuzione delle regole: ` +
        `${errorMessages}`
      );
    }

    const validExitCode =
      result.exitCode === 0 ||
      (
        result.exitCode === 1 &&
        parsed.results.length > 0
      );

    if (!validExitCode) {
      throw new Error(
        (
          `Semgrep è terminato con codice ` +
          `${result.exitCode}: ${result.stderr}`
        ).trim()
      );
    }

    const rawFindings: SastFinding[] =
      parsed.results.map((item) => {
        const severity = (
          item.extra?.severity ?? 'WARNING'
        ).toUpperCase();

        const mappedSeverity:
          | 'ERROR'
          | 'WARNING'
          | 'INFO' =
          severity === 'ERROR'
            ? 'ERROR'
            : severity === 'INFO'
              ? 'INFO'
              : 'WARNING';

        const rawCwe =
          item.extra?.metadata?.cwe;

        const cweHierarchy: string[] = [];

        if (Array.isArray(rawCwe)) {
          cweHierarchy.push(...rawCwe);
        } else if (typeof rawCwe === 'string') {
          cweHierarchy.push(rawCwe);
        }

        return {
          ruleId: item.check_id,
          path: item.path,
          startLine: item.start.line,
          endLine: item.end.line,
          severity: mappedSeverity,
          message: item.extra?.message ?? '',
          cweHierarchy,
          owaspCategory:
            item.extra?.metadata?.['owasp-top-ten']
        };
      });

    const modifiedRanges =
      DiffScoper.extractModifiedLineRanges(
        patchDiff
      );

    return DiffScoper.filterFindings(
      rawFindings,
      modifiedRanges,
      scannedFiles,
      category,
      this.repoRoot
    );
  }

  private resolveFilesToScan(
    targetFiles: readonly string[],
    patchDiff: string,
    category: ExperimentCategory
  ): ReadonlySet<string> {
    const filesToScan =
      new Set<string>(targetFiles);

    if (category === 'CREATE') {
      const fileDiffs =
        parseFileDiffs(patchDiff);

      for (const fileDiff of fileDiffs) {
        if (fileDiff.file) {
          filesToScan.add(fileDiff.file);
        }
      }
    }

    return filesToScan;
  }
}
