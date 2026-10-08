import { SastFinding } from '../types/domain.js';
import { ExperimentCategory } from '../types/analytics.js';

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export class DiffScoper {
  public static extractModifiedLineRanges(unifiedDiff: string): Map<string, LineRange[]> {
    const fileRanges = new Map<string, LineRange[]>();
    const lines = unifiedDiff.split('\n');
    let currentFile: string | null = null;
    let isNewFile = false;
    const hunkHeaderRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

    for (const line of lines) {
      if (line.startsWith('--- /dev/null')) {
        isNewFile = true;
        continue;
      }
      if (line.startsWith('+++ b/')) {
        currentFile = line.substring(6).trim();
        if (!fileRanges.has(currentFile)) {
          fileRanges.set(currentFile, []);
        }
        continue;
      }
      if (currentFile && line.startsWith('@@')) {
        const match = hunkHeaderRegex.exec(line);
        if (match && match[2]) {
          const startLine = parseInt(match[2], 10);
          const lineCount = match[3] !== undefined ? parseInt(match[3], 10) : 1;
          const endLine = lineCount === 0 ? startLine : startLine + lineCount - 1;

          // Se il file è nuovo, copre da riga 1 a endLine
          const start = isNewFile ? 1 : Math.max(1, startLine - 3);
          const end = endLine + (isNewFile ? 0 : 3);

          fileRanges.get(currentFile)!.push({ start, end });
        }
      }
    }
    return fileRanges;
  }

  public static filterFindings(
    findings: readonly SastFinding[],
    modifiedRanges: Map<string, LineRange[]>,
    targetFiles: readonly string[] = [],
    category: ExperimentCategory = 'REPAIR'
  ): readonly SastFinding[] {
    const targetSet = new Set(targetFiles.map((f) => f.replace(/\\/g, '/')));

    return findings.filter((finding) => {
      const normalizedPath = finding.path.replace(/\\/g, '/');
      const isTargetFile = Array.from(targetSet).some((target) => normalizedPath.endsWith(target));

      // 1. In modalità CREATE: il file è generato da zero. Non esiste debito pregresso.
      // Tutte le violazioni emerse nel file creato sono addebitate alla patch.
      if (category === 'CREATE' && isTargetFile) {
        return true;
      }

      // 2. In modalità REPAIR: qualsiasi violazione grave (ERROR o OWASP/CWE) presente
      // sul file target deve essere risolta dal Coder. Non può essere ignorata.
      if (category === 'REPAIR' && isTargetFile) {
        const isSecurityVulnerability =
          finding.severity === 'ERROR' ||
          (finding.cweHierarchy && finding.cweHierarchy.length > 0) ||
          Boolean(finding.owaspCategory);

        if (isSecurityVulnerability) {
          return true;
        }
      }

      // 3. Warning stilistici o file secondari: filtraggio per coordinate differenziali (R_patch)
      let ranges = modifiedRanges.get(finding.path);
      if (!ranges) {
        for (const [filePath, r] of modifiedRanges.entries()) {
          if (normalizedPath.endsWith(filePath.replace(/\\/g, '/'))) {
            ranges = r;
            break;
          }
        }
      }

      if (!ranges || ranges.length === 0) {
        return false;
      }

      return ranges.some((r) => finding.startLine >= r.start && finding.startLine <= r.end);
    });
  }
}
