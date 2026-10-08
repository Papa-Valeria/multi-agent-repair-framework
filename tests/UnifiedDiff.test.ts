import { describe, expect, it } from '@jest/globals';
import { applyHunksToContent, measurePatchGrounding, parseFileDiffs } from '../src/git/UnifiedDiff.js';

const original = 'def authenticate(token: str) -> bool:\n    query = "SELECT * FROM tokens WHERE t = " + token\n    return False';

describe('Unified diff preview and application share one engine', () => {
  it('never appends hunk lines after the file when the diff context does not exist', () => {
    const diff = [
      'diff --git a/service.py b/service.py',
      '--- a/service.py',
      '+++ b/service.py',
      '@@ -11,7 +11,7 @@ def authenticate(token: str) -> bool:',
      '     query = "SELECT * FROM tokens WHERE t = ?"',
      '     cursor = conn.cursor()',
      '     cursor.execute(query, (token,))',
      '-    return False',
      '+    return bool(cursor.fetchone())'
    ].join('\n');

    const [fileDiff] = parseFileDiffs(diff);

    expect(fileDiff?.file).toBe('service.py');
    expect(applyHunksToContent(original, fileDiff!.hunks)).toBe(
      'def authenticate(token: str) -> bool:\n    query = "SELECT * FROM tokens WHERE t = " + token\n    return bool(cursor.fetchone())'
    );
  });

  it('replaces the removed lines in place when the context matches', () => {
    const diff = [
      '--- a/service.py',
      '+++ b/service.py',
      '@@ -2,2 +2,3 @@',
      '     query = "SELECT * FROM tokens WHERE t = " + token',
      '-    return False',
      '+    cursor = conn.cursor()',
      '+    return True'
    ].join('\n');

    const [fileDiff] = parseFileDiffs(diff);

    expect(applyHunksToContent(original, fileDiff!.hunks)).toBe(
      'def authenticate(token: str) -> bool:\n    query = "SELECT * FROM tokens WHERE t = " + token\n    cursor = conn.cursor()\n    return True'
    );
  });

  it('measures how many old-side lines of a diff do not exist in the original source', () => {
    const invented = [
      '--- a/service.py',
      '+++ b/service.py',
      '@@ -11,7 +11,7 @@',
      '     query = "SELECT * FROM tokens WHERE t = ?"',
      '     cursor = conn.cursor()',
      '     cursor.execute(query, (token,))',
      '-    return False',
      '+    return bool(cursor.fetchone())'
    ].join('\n');
    const grounded = ['--- a/service.py', '+++ b/service.py', '@@ -2,2 +2,2 @@', '     query = "SELECT * FROM tokens WHERE t = " + token', '-    return False', '+    return True'].join('\n');
    const additionOnly = ['--- a/service.py', '+++ b/service.py', '@@ -3,0 +4 @@', '+    x = 1'].join('\n');

    expect(measurePatchGrounding(invented, { 'service.py': original })).toEqual({ hunks: 1, ungroundedHunks: 1, oldSideLines: 4, ungroundedLines: 3 });
    expect(measurePatchGrounding(grounded, { 'service.py': original })).toEqual({ hunks: 1, ungroundedHunks: 0, oldSideLines: 2, ungroundedLines: 0 });
    expect(measurePatchGrounding(additionOnly, { 'service.py': original })).toEqual({ hunks: 0, ungroundedHunks: 0, oldSideLines: 0, ungroundedLines: 0 });
  });

  it('treats a removed line starting with dashes as content, not as a file header', () => {
    const diff = ['--- a/q.sql', '+++ b/q.sql', '@@ -1,2 +1,2 @@', ' SELECT 1', '--- old comment', '+-- new comment'].join('\n');

    const [fileDiff] = parseFileDiffs(diff);

    expect(applyHunksToContent('SELECT 1\n-- old comment', fileDiff!.hunks)).toBe('SELECT 1\n-- new comment');
  });
});
