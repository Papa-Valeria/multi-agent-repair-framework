import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { applyHunksToContent, parseFileDiffs } from './UnifiedDiff.js';

const execFileAsync = promisify(execFile);

export type PatchApplyMode = 'GIT' | 'FUZZY';

export class GitManager {
  constructor(private readonly repoRoot: string) { }

  public computePatchHash(unifiedDiff: string): string {
    const normalizedDiff = unifiedDiff.replace(/\r\n/g, '\n').trim();
    return crypto.createHash('sha256').update(normalizedDiff).digest('hex');
  }

  public async dryRunPatch(unifiedDiff: string): Promise<boolean> {
    const tempPatchPath = path.join(this.repoRoot, `.tmp_eval_${Date.now()}.patch`);
    try {
      const normalizedDiff = unifiedDiff.replace(/\r\n/g, '\n').trim() + '\n';
      await fs.writeFile(tempPatchPath, normalizedDiff, 'utf-8');
      try {
        await execFileAsync(
          'git',
          [
            'apply',
            '--check',
            '-p1',
            '-C1',
            '--unidiff-zero',
            '--ignore-space-change',
            '--ignore-whitespace',
            '--recount',
            tempPatchPath
          ],
          { cwd: this.repoRoot }
        );
        return true;
      } catch {
        return this.canApplyFuzzy(unifiedDiff);
      }
    } finally {
      await fs.rm(tempPatchPath, { force: true });
    }
  }

  public async applyPatch(unifiedDiff: string): Promise<PatchApplyMode> {
    const tempPatchPath = path.join(this.repoRoot, `.tmp_apply_${Date.now()}.patch`);
    try {
      const normalizedDiff = unifiedDiff.replace(/\r\n/g, '\n').trim() + '\n';
      await fs.writeFile(tempPatchPath, normalizedDiff, 'utf-8');
      try {
        await execFileAsync(
          'git',
          [
            'apply',
            '-p1',
            '-C1',
            '--unidiff-zero',
            '--whitespace=nowarn',
            '--ignore-space-change',
            '--ignore-whitespace',
            '--recount',
            tempPatchPath
          ],
          { cwd: this.repoRoot }
        );
        return 'GIT';
      } catch (gitErr: any) {
        const applied = await this.applyFuzzy(unifiedDiff);
        if (!applied) {
          throw new Error(`Git apply e Fuzzy fallback entrambi falliti: ${gitErr?.message}`);
        }
        return 'FUZZY';
      }
    } finally {
      await fs.rm(tempPatchPath, { force: true });
    }
  }

  private async applyFuzzy(unifiedDiff: string): Promise<boolean> {
    const updates = await this.computeFuzzyUpdates(unifiedDiff);
    if (!updates) return false;
    try {
      for (const [absolutePath, content] of updates) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, content, 'utf-8');
      }
    } catch {
      return false;
    }
    return true;
  }

  private async canApplyFuzzy(unifiedDiff: string): Promise<boolean> {
    return (await this.computeFuzzyUpdates(unifiedDiff)) !== null;
  }

  private async computeFuzzyUpdates(unifiedDiff: string): Promise<Map<string, string> | null> {
    const fileDiffs = parseFileDiffs(unifiedDiff);
    if (fileDiffs.length === 0) return null;

    const root = path.resolve(this.repoRoot);
    const updates = new Map<string, string>();

    for (const { file, hunks } of fileDiffs) {
      const absolutePath = path.resolve(root, file);
      const relative = path.relative(root, absolutePath);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
      if (hunks.length === 0) return null;

      try {
        let current = updates.get(absolutePath);
        if (current === undefined) {
          try {
            current = await fs.readFile(absolutePath, 'utf-8');
          } catch (err: unknown) {
            // File non esistente: buffer vuoto per creazione
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              current = '';
            } else {
              return null;
            }
          }
        }

        const patched = applyHunksToContent(current, hunks);
        if (patched === null) return null;
        updates.set(absolutePath, patched);
      } catch {
        return null;
      }
    }

    return updates;
  }

  public async hardReset(): Promise<void> {
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: this.repoRoot });
    await execFileAsync('git', ['clean', '-fd'], { cwd: this.repoRoot });
  }

  public async commitChanges(message: string, files?: readonly string[]): Promise<string> {
    const addArgs = ['add', '-A'];
    if (files?.length) {
      addArgs.push('--', ...files);
    }
    await execFileAsync('git', addArgs, { cwd: this.repoRoot });
    const commitArgs = ['commit', '--only', '-m', message];
    if (files?.length) {
      commitArgs.push('--', ...files);
    }
    await execFileAsync('git', commitArgs, { cwd: this.repoRoot });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.repoRoot });
    return stdout.trim();
  }

  public async rollback(): Promise<void> {
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: this.repoRoot });
    await execFileAsync('git', ['clean', '-fd', '-e', '__pycache__', '-e', '.pytest_cache'], { cwd: this.repoRoot });
  }
}
