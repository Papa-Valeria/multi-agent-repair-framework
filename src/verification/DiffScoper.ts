import { SastFinding } from '../types/domain.js';

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export class DiffScoper {
  /**
   * Estrae per ciascun file interessato l'insieme degli intervalli di riga aggiunti o modificati:
   * R_patch = U_k [start_k, end_k]
   */
  public static extractModifiedLineRanges(unifiedDiff: string): Map<string, LineRange[]> {
    const fileRanges = new Map<string, LineRange[]>();
    const lines = unifiedDiff.split('\n');

    let currentFile: string | null = null;
    const hunkHeaderRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

    for (const line of lines) {
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

          fileRanges.get(currentFile)!.push({ start: startLine, end: endLine });
        }
      }
    }

    return fileRanges;
  }

  /**
   * Diff-aware Scoping: isola unicamente i rilievi SAST inclusi nelle coordinate del diff (RF-04).
   * f.startLine \in R_patch
   */
  public static filterFindings(
    findings: readonly SastFinding[],
    modifiedRanges: Map<string, LineRange[]>
  ): readonly SastFinding[] {
    return findings.filter((finding) => {
      const ranges = modifiedRanges.get(finding.path);
      if (!ranges || ranges.length === 0) {
        return false;
      }
      return ranges.some(
        (r) => finding.startLine >= r.start && finding.startLine <= r.end
      );
    });
  }
}
