import { GitManager } from '../src/git/GitManager.js';
import { describe, it, expect } from '@jest/globals';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('GitManager - DryRun e Verifica Hash', () => {
  const git = new GitManager(process.cwd());

  it('deve calcolare hash SHA-256 identici per patch equivalenti', () => {
    const diff1 = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n';
    const diff2 = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n';
    expect(git.computePatchHash(diff1)).toBe(git.computePatchHash(diff2));
  });

  it('normalizza CRLF e LF prima dell’hashing della patch', () => {
    const unixDiff = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new';
    const windowsDiff = unixDiff.replace(/\n/g, '\r\n');

    expect(git.computePatchHash(windowsDiff)).toBe(git.computePatchHash(unixDiff));
  });

  it('deve fallire il dry-run su un diff sintatticamente non applicabile', async () => {
    const corruptedDiff = 'INVALID UNIFIED DIFF CONTENT';
    const result = await git.dryRunPatch(corruptedDiff);
    expect(result).toBe(false);
  });

  it('committa i file target senza includere altri file già staged', async () => {
    const temporaryRepo = await mkdtemp(path.join(os.tmpdir(), 'git-manager-approval-'));
    try {
      await execFileAsync('git', ['init'], { cwd: temporaryRepo });
      await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: temporaryRepo });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: temporaryRepo });
      await writeFile(path.join(temporaryRepo, 'target.txt'), 'before\n');
      await writeFile(path.join(temporaryRepo, 'unrelated.txt'), 'before\n');
      await execFileAsync('git', ['add', '-A'], { cwd: temporaryRepo });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: temporaryRepo });

      await writeFile(path.join(temporaryRepo, 'target.txt'), 'after\n');
      await writeFile(path.join(temporaryRepo, 'unrelated.txt'), 'user change\n');
      await execFileAsync('git', ['add', '--', 'unrelated.txt'], { cwd: temporaryRepo });

      await new GitManager(temporaryRepo).commitChanges('approved patch', ['target.txt']);

      const { stdout: committedFiles } = await execFileAsync(
        'git',
        ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
        { cwd: temporaryRepo }
      );
      const { stdout: remainingChanges } = await execFileAsync(
        'git',
        ['status', '--porcelain'],
        { cwd: temporaryRepo }
      );

      expect(committedFiles.trim()).toBe('target.txt');
      expect(remainingChanges).toContain('unrelated.txt');
    } finally {
      await rm(temporaryRepo, { recursive: true, force: true });
    }
  });
});
