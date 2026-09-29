import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

export class GitManager {
  constructor(private readonly repoRoot: string) {}

  /**
   * Calcola l'hash SHA-256 della patch per mitigare oscillazioni (Patch Flapping).
   */
  public computePatchHash(unifiedDiff: string): string {
    return crypto.createHash('sha256').update(unifiedDiff.trim()).digest('hex');
  }

  /**
   * Dry-run a livello di OS per verificare l'applicabilità sintattica del diff.
   */
  public async dryRunPatch(unifiedDiff: string): Promise<boolean> {
    const tempPatchPath = path.join(this.repoRoot, `.tmp_eval_${Date.now()}.patch`);
    try {
      const normalizedDiff = unifiedDiff.replace(/\r\n/g, '\n').trim() + '\n';
      await fs.writeFile(tempPatchPath, normalizedDiff, 'utf-8');

      // Tentativo 1: git apply --check standard con tolleranza fuzz
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
        // Tentativo 2: verifica se l'engine di fallback fuzzy agnostico è in grado di applicarla
        return this.canApplyFuzzy(unifiedDiff);
      }
    } finally {
      await fs.rm(tempPatchPath, { force: true });
    }
  }

  /**
   * Applica la patch in modo persistente sul repository (Two-Stage Engine).
   */
  public async applyPatch(unifiedDiff: string): Promise<void> {
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
      } catch (gitErr: any) {
        // Stadio 2: Fallback all'applicazione fuzzy agnostica
        const applied = await this.applyFuzzy(unifiedDiff);
        if (!applied) {
          throw new Error(`Git apply e Fuzzy fallback entrambi falliti: ${gitErr?.message}`);
        }
      }
    } finally {
      await fs.rm(tempPatchPath, { force: true });
    }
  }

  /**
   * Engine agnostico: estrae le sezioni '-' e '+' dai diff hunks e applica
   * la sostituzione sul file target superando i disallineamenti di context lines.
   */
  private async applyFuzzy(unifiedDiff: string): Promise<boolean> {
    const hunks = this.parseUnifiedHunks(unifiedDiff);
    if (hunks.length === 0) return false;

    for (const { file, toRemove, toAdd } of hunks) {
      const targetFilePath = path.join(this.repoRoot, file);
      try {
        const originalContent = await fs.readFile(targetFilePath, 'utf-8');
        const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');

        // Ricerca esatta o normalizzata sui whitespace del blocco da rimuovere
        if (toRemove.length > 0 && normalizedOriginal.includes(toRemove)) {
          const updated = normalizedOriginal.replace(toRemove, toAdd);
          await fs.writeFile(targetFilePath, updated, 'utf-8');
        } else {
          // Se la riga di rimozione non matcha per via di whitespace, tentiamo linea per linea
          const cleanRemove = toRemove.trim();
          if (cleanRemove && normalizedOriginal.includes(cleanRemove)) {
            const updated = normalizedOriginal.replace(cleanRemove, toAdd.trim());
            await fs.writeFile(targetFilePath, updated, 'utf-8');
          } else {
            return false;
          }
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private async canApplyFuzzy(unifiedDiff: string): Promise<boolean> {
    const hunks = this.parseUnifiedHunks(unifiedDiff);
    if (hunks.length === 0) return false;

    for (const { file, toRemove } of hunks) {
      const targetFilePath = path.join(this.repoRoot, file);
      try {
        const originalContent = await fs.readFile(targetFilePath, 'utf-8');
        const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
        if (!normalizedOriginal.includes(toRemove) && !normalizedOriginal.includes(toRemove.trim())) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

 private parseUnifiedHunks(diffText: string): Array<{ file: string; toRemove: string; toAdd: string }> {
    const results: Array<{ file: string; toRemove: string; toAdd: string }> = [];
    const fileBlocks = diffText.split(/(?=diff --git )/g);

    for (const block of fileBlocks) {
      const fileMatch = block.match(/\+\+\+ b\/(\S+)/);
      if (!fileMatch || !fileMatch[1]) continue;
      const file = fileMatch[1];

      const hunkBlocks = block.split(/(?=@@ -\d+.*@@)/g).slice(1);

      for (const hunk of hunkBlocks) {
        const rawLines = hunk.split('\n').filter(l => !l.startsWith('@@ '));
        const oldBlockLines: string[] = [];
        const newBlockLines: string[] = [];

        for (const line of rawLines) {
          if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;

          if (line.startsWith('-')) {
            oldBlockLines.push(line.slice(1));
          } else if (line.startsWith('+')) {
            newBlockLines.push(line.slice(1));
          } else {
            const contextLine = line.startsWith(' ') ? line.slice(1) : line;
            oldBlockLines.push(contextLine);
            newBlockLines.push(contextLine);
          }
        }

        const toRemove = oldBlockLines.join('\n').trim();
        const toAdd = newBlockLines.join('\n').trim();

        if (toRemove.length > 0 || toAdd.length > 0) {
          results.push({
            file,
            toRemove: oldBlockLines.filter((_, idx) => rawLines[idx]?.startsWith('-')).join('\n') || toRemove,
            toAdd: newBlockLines.filter((_, idx) => rawLines[idx]?.startsWith('+')).join('\n') || toAdd
          });
        }
      }
    }
    return results;
  }

  public async hardReset(): Promise<void> {
    await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: this.repoRoot });
    await execFileAsync('git', ['clean', '-fd'], { cwd: this.repoRoot });
  }

  public async commitChanges(message: string): Promise<string> {
    await execFileAsync('git', ['add', '-A'], { cwd: this.repoRoot });
    await execFileAsync('git', ['commit', '-m', message], { cwd: this.repoRoot });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.repoRoot });
    return stdout.trim();
  }

  public async rollback(): Promise<void> {
    try {
      await execFileAsync('git', ['reset', '--hard', 'HEAD'], { cwd: this.repoRoot });
    } catch (err: any) {
      console.warn('[GitManager] Warning during git reset:', err?.message);
    }

    try {
      await execFileAsync('git', ['clean', '-fd', '-e', '__pycache__', '-e', '.pytest_cache'], { cwd: this.repoRoot });
    } catch (err: any) {
      console.warn('[GitManager] Warning during git clean (ignored):', err?.message);
    }
  }
}
