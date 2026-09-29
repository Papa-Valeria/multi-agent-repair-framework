import { ProcessRunner } from './ProcessRunner.js';
import { DiffScoper } from './DiffScoper.js';
import { SastFinding } from '../types/domain.js';

interface RawSemgrepOutput {
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
  constructor(private readonly repoRoot: string) {}

  public async scan(targetFiles: readonly string[], patchDiff: string): Promise<readonly SastFinding[]> {
    if (targetFiles.length === 0) return [];

    const args = [
      'scan',
      '--config=auto',
      '--config=p/owasp-top-ten',
      '--config=p/cwe',
      '--json',
      ...targetFiles
    ];

    const result = await ProcessRunner.execute('semgrep', args, this.repoRoot, 60000);
    if (!result.stdout.trim()) {
      return [];
    }

    let parsed: RawSemgrepOutput;
    try {
      parsed = JSON.parse(result.stdout) as RawSemgrepOutput;
    } catch {
      throw new Error(`Parsing fallito per l'output JSON di Semgrep: ${result.stderr}`);
    }

    const rawFindings: SastFinding[] = (parsed.results ?? []).map((item) => {
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

    // Applica diff-aware scoping (RF-04)
    const modifiedRanges = DiffScoper.extractModifiedLineRanges(patchDiff);
    return DiffScoper.filterFindings(rawFindings, modifiedRanges);
  }
}
