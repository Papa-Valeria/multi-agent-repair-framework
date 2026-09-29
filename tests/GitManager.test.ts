import { GitManager } from '../src/git/GitManager.js';
import { describe, it, expect } from '@jest/globals';

describe('GitManager - DryRun e Verifica Hash', () => {
  const git = new GitManager(process.cwd());

  it('deve calcolare hash SHA-256 identici per patch equivalenti', () => {
    const diff1 = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n';
    const diff2 = '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-old\n+new\n';
    expect(git.computePatchHash(diff1)).toBe(git.computePatchHash(diff2));
  });

  it('deve fallire il dry-run su un diff sintatticamente non applicabile', async () => {
    const corruptedDiff = 'INVALID UNIFIED DIFF CONTENT';
    const result = await git.dryRunPatch(corruptedDiff);
    expect(result).toBe(false);
  });
});
