import type { SastFinding } from '../types/domain.js';
import type { ExperimentCategory } from '../types/analytics.js';
import { parseFileDiffs, type ParsedHunk } from '../git/UnifiedDiff.js';
import { canonicalizeRepositoryPath, RepositoryPathPolicyError } from '../security/RepositoryPathPolicy.js';

export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export class DiffScoper {
  private static readonly CONTEXT_LINES = 3;

  public static extractModifiedLineRanges(unifiedDiff: string): Map<string, LineRange[]> {
    const fileRanges = new Map<string, LineRange[]>();
    const fileDiffs = parseFileDiffs(unifiedDiff);

    for (const fileDiff of fileDiffs) {
      const filePath = this.normalizePath(fileDiff.file);

      if (!filePath) {
        continue;
      }

      const ranges: LineRange[] = [];

      for (const hunk of fileDiff.hunks) {
        ranges.push(
          ...this.extractRangesFromHunk(
            hunk,
            fileDiff.isNewFile
          )
        );
      }
      const existingRanges = fileRanges.get(filePath) ?? [];
      fileRanges.set(filePath, this.mergeRanges([...existingRanges, ...ranges]));
    }

    return fileRanges;
  }

  public static filterFindings(
    findings: readonly SastFinding[],
    modifiedRanges: ReadonlyMap<
      string,
      readonly LineRange[]
    >,
    targetFiles: readonly string[],
    category: ExperimentCategory,
    repositoryRoot: string
  ): readonly SastFinding[] {
    const canonicalTargetFiles =
      new Set<string>();

    for (const targetFile of targetFiles) {
      const canonicalTarget =
        this.canonicalizeForMatching(
          repositoryRoot,
          targetFile
        );

      if (canonicalTarget !== null) {
        canonicalTargetFiles.add(
          canonicalTarget
        );
      }
    }

    const canonicalModifiedRanges =
      new Map<
        string,
        readonly LineRange[]
      >();

    for (
      const [
        filePath,
        ranges
      ] of modifiedRanges.entries()
    ) {
      const canonicalPath =
        this.canonicalizeForMatching(
          repositoryRoot,
          filePath
        );

      if (canonicalPath === null) {
        continue;
      }

      canonicalModifiedRanges.set(
        canonicalPath,
        ranges
      );
    }

    return findings.filter(
      (finding) => {
        const canonicalFindingPath =
          this.canonicalizeForMatching(
            repositoryRoot,
            finding.path
          );

        if (canonicalFindingPath === null) {
          return false;
        }

        const isTargetFile =
          canonicalTargetFiles.has(
            canonicalFindingPath
          );

        if (
          category === 'REPAIR' &&
          isTargetFile
        ) {
          const isSecurityVulnerability =
            finding.severity === 'ERROR' ||
            Boolean(
              finding.cweHierarchy &&
              finding.cweHierarchy.length > 0
            ) ||
            Boolean(
              finding.owaspCategory
            );

          if (isSecurityVulnerability) {
            return true;
          }
        }

        const ranges =
          this.findRangesForPath(
            canonicalFindingPath,
            canonicalModifiedRanges
          );

        if (
          ranges === undefined ||
          ranges.length === 0
        ) {
          return false;
        }

        return ranges.some(
          (range) =>
            finding.endLine >=
            range.start &&
            finding.startLine <=
            range.end
        );
      }
    );
  }

  private static extractRangesFromHunk(hunk: ParsedHunk, isNewFile: boolean): LineRange[] {
    if (isNewFile) {
      const producedLineCount = hunk.lines.filter((line) => line.kind !== '-').length;

      if (producedLineCount === 0) {
        return [];
      }

      const start = Math.max(1, hunk.newStart);

      return [
        {
          start: start,
          end: start + producedLineCount - 1
        }
      ];
    }

    const ranges: LineRange[] = [];
    let newLine = Math.max(1, hunk.newStart);
    let changeStart: number | null = null;
    let changeEnd: number | null = null;

    const flushChange = (): void => {
      if (changeStart === null || changeEnd === null) {
        changeStart = null;
        changeEnd = null;
        return;
      }

      ranges.push({
        start: Math.max(1, changeStart - this.CONTEXT_LINES),
        end: changeEnd + this.CONTEXT_LINES
      });

      changeStart = null;
      changeEnd = null;
    };

    for (const line of hunk.lines) {
      if (line.kind === ' ') {
        flushChange();
        newLine++;
        continue;
      }

      if (line.kind === '+') {
        if (changeStart === null) {
          changeStart = newLine;
        }

        changeEnd = Math.max(changeStart, newLine);
        newLine++;
        continue;
      }

      if (line.kind === '-') {
        if (changeStart === null) {
          changeStart = newLine;
        }

        changeEnd = Math.max(changeStart, newLine);
      }
    }

    flushChange();

    return ranges;
  }

  private static findRangesForPath(
    canonicalFindingPath: string,
    modifiedRanges: ReadonlyMap<
      string,
      readonly LineRange[]
    >
  ): readonly LineRange[] | undefined {
    return modifiedRanges.get(
      canonicalFindingPath
    );
  }

  private static mergeRanges(ranges: readonly LineRange[]): LineRange[] {
    if (ranges.length === 0) {
      return [];
    }

    const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);

    const merged: LineRange[] = [];

    for (const range of sorted) {
      const previous = merged[merged.length - 1];

      if (!previous || range.start > previous.end + 1) {
        merged.push({
          start: range.start,
          end: range.end
        });

        continue;
      }

      merged[merged.length - 1] = {
        start: previous.start,
        end: Math.max(previous.end, range.end)
      };
    }

    return merged;
  }

  private static canonicalizeForMatching(
    repositoryRoot: string,
    candidatePath: string
  ): string | null {
    try {
      return canonicalizeRepositoryPath({
        repositoryRoot,
        candidatePath
      }).relativePath;
    } catch (error: unknown) {
      if (
        error instanceof
        RepositoryPathPolicyError
      ) {
        return null;
      }

      throw error;
    }
  }

  private static normalizePath(filePath: string): string {
    let normalized = filePath.replace(/\\/g, '/').trim();

    while (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }
}
