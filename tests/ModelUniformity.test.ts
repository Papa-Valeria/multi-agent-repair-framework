import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { CoderAgent } from '../src/agents/CoderAgent.js';
import { ReviewerAgent } from '../src/agents/ReviewerAgent.js';
import { GitManager } from '../src/git/GitManager.js';
import type { OpenAICompatibleClient } from '../src/inference/OpenAICompatibleClient.js';
import { TestExecutionReport } from '../src/types/domain.js';
import { ProcessRunner } from '../src/verification/ProcessRunner.js';
import { TestHarness } from '../src/verification/TestHarness.js';

const execFileAsync = promisify(execFile);

interface FuzzyAccess {
  applyFuzzy(diff: string): Promise<boolean>;
}

describe('Patch application is identical for every model', () => {
  let repo: string;
  let git: GitManager;

  const writeAndCommit = async (name: string, content: string): Promise<void> => {
    await writeFile(path.join(repo, name), content);
    await execFileAsync('git', ['add', '-A'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
  };

  beforeEach(async () => {
    repo = await mkdtemp(path.join(os.tmpdir(), 'patch-uniformity-'));
    await execFileAsync('git', ['init'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    git = new GitManager(repo);
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('anchors a diff with invented context to its removed lines and discards the unverifiable context', async () => {
    const original = 'def authenticate(token: str) -> bool:\n    query = "SELECT * FROM tokens WHERE t = " + token\n    return False\n';
    await writeAndCommit('service.py', original);
    const hallucinated = [
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

    expect(await git.dryRunPatch(hallucinated)).toBe(true);
    expect(await git.applyPatch(hallucinated)).toBe('FUZZY');
    expect(await readFile(path.join(repo, 'service.py'), 'utf-8')).toBe(
      'def authenticate(token: str) -> bool:\n    query = "SELECT * FROM tokens WHERE t = " + token\n    return bool(cursor.fetchone())\n'
    );
  });

  it('replaces a fully rewritten function when only the leading imports in the context are invented', async () => {
    await writeAndCommit(
      'service.py',
      'def authenticate(token: str) -> bool:\n    query = "SELECT * FROM tokens WHERE t = " + token\n    return False\n'
    );
    const rewrite = [
      '--- a/service.py',
      '+++ b/service.py',
      '@@ -1,5 +1,5 @@',
      ' import psycopg2',
      ' from psycopg2 import sql',
      ' ',
      '-def authenticate(token: str) -> bool:',
      '-    query = "SELECT * FROM tokens WHERE t = " + token',
      '-    return False',
      '+def authenticate(token: str) -> bool:',
      '+    return True'
    ].join('\n');

    expect(await (git as unknown as FuzzyAccess).applyFuzzy(rewrite)).toBe(true);
    expect(await readFile(path.join(repo, 'service.py'), 'utf-8')).toBe('def authenticate(token: str) -> bool:\n    return True\n');
  });

  it('still applies a diff with ambiguous removed lines (nearest to the header) and with invented-only additions', async () => {
    await writeAndCommit('twice.py', 'def a():\n    return False\n\ndef b():\n    return False\n');
    const ambiguous = ['--- a/twice.py', '+++ b/twice.py', '@@ -40,2 +40,2 @@', ' invented context', '-    return False', '+    return True'].join('\n');

    expect(await (git as unknown as FuzzyAccess).applyFuzzy(ambiguous)).toBe(true);
    expect(await readFile(path.join(repo, 'twice.py'), 'utf-8')).toBe('def a():\n    return False\n\ndef b():\n    return True\n');

    const additionOnly = ['--- a/twice.py', '+++ b/twice.py', '@@ -40,2 +40,3 @@', ' invented context', '+    x = 1'].join('\n');
    expect(await (git as unknown as FuzzyAccess).applyFuzzy(additionOnly)).toBe(true);
    expect(await readFile(path.join(repo, 'twice.py'), 'utf-8')).toBe('def a():\n    return False\n\ndef b():\n    return True\n    x = 1\n');
  });

  it('applies a diff with wrong line numbers and flattened context while keeping file indentation', async () => {
    await writeAndCommit(
      'service.py',
      'def authenticate(token: str) -> bool:\n    query = "SELECT 1"\n    cursor.execute(query)\n    return False\n'
    );
    const diff = [
      '--- a/service.py',
      '+++ b/service.py',
      '@@ -40,3 +40,3 @@',
      'query = "SELECT 1"',
      'cursor.execute(query)',
      '-return False',
      '+    return True'
    ].join('\n');

    expect(await git.dryRunPatch(diff)).toBe(true);
    expect(await (git as unknown as FuzzyAccess).applyFuzzy(diff)).toBe(true);
    expect(await readFile(path.join(repo, 'service.py'), 'utf-8')).toBe(
      'def authenticate(token: str) -> bool:\n    query = "SELECT 1"\n    cursor.execute(query)\n    return True\n'
    );
  });

  it('preserves CRLF line endings when the fuzzy engine rewrites a file', async () => {
    await writeAndCommit('crlf.py', 'def f():\r\n    return 1\r\n');
    const diff = ['--- a/crlf.py', '+++ b/crlf.py', '@@ -9,2 +9,2 @@', 'def f():', '-return 1', '+    return 2'].join('\n');

    expect(await (git as unknown as FuzzyAccess).applyFuzzy(diff)).toBe(true);
    expect(await readFile(path.join(repo, 'crlf.py'), 'utf-8')).toBe('def f():\r\n    return 2\r\n');
  });

  it('applies the hunks it can anchor and still inserts a hunk whose removed lines do not exist', async () => {
    await writeAndCommit('values.py', 'a = 1\nb = 2\n');
    const diff = [
      '--- a/values.py',
      '+++ b/values.py',
      '@@ -1 +1 @@',
      '-a = 1',
      '+a = 10',
      '@@ -2 +2 @@',
      '-b = 999',
      '+b = 20'
    ].join('\n');

    expect(await (git as unknown as FuzzyAccess).applyFuzzy(diff)).toBe(true);
    expect(await readFile(path.join(repo, 'values.py'), 'utf-8')).toBe('a = 10\nb = 20\nb = 2\n');
  });

  it('has no output only when the diff contains no change at all', async () => {
    await writeAndCommit('values.py', 'a = 1\n');
    const noChange = ['--- a/values.py', '+++ b/values.py', '@@ -1 +1 @@', ' a = 1'].join('\n');

    expect(await (git as unknown as FuzzyAccess).applyFuzzy(noChange)).toBe(false);
  });

  it('refuses diffs that point outside the repository', async () => {
    await writeAndCommit('inside.py', 'x = 1\n');
    const diff = ['--- a/../outside.py', '+++ b/../outside.py', '@@ -1 +1 @@', '-x = 1', '+x = 2'].join('\n');

    expect(await git.dryRunPatch(diff)).toBe(false);
    expect(await (git as unknown as FuzzyAccess).applyFuzzy(diff)).toBe(false);
  });
});

describe('Pytest collection errors are patch failures, not oracle failures', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('routes an IndentationError at collection time to refinement with the real cause', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 2,
      stdout: [
        'E     File "service.py", line 4',
        'E       cursor = conn.cursor()',
        'E   IndentationError: unexpected indent',
        '!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!',
        '1 error in 0.34s'
      ].join('\n'),
      stderr: '',
      timedOut: false,
      durationMs: 340
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(false);
    expect(report.suitePassed).toBe(false);
    expect(report.errorTests).toBe(1);
    expect(report.failureDetails[0]?.testName).toBe('CollectionError');
    expect(report.failureDetails[0]?.assertionMessage).toContain('IndentationError');
  });

  it('keeps exit code 2 without a collection marker as an oracle failure', async () => {
    jest.spyOn(ProcessRunner, 'execute').mockResolvedValue({
      exitCode: 2,
      stdout: '1 error in 0.30s',
      stderr: '',
      timedOut: false,
      durationMs: 300
    });

    const report = await new TestHarness(process.cwd()).executeSuite();

    expect(report.oracleFailed).toBe(true);
    expect(report.suitePassed).toBe(false);
  });
});

describe('Agents do not depend on the task or the model', () => {
  it('only strips real test files from a generated diff', () => {
    const coder = new CoderAgent({} as OpenAICompatibleClient);
    const diff = [
      'diff --git a/latest.py b/latest.py',
      '--- a/latest.py',
      '+++ b/latest.py',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/test_service.py b/test_service.py',
      '--- a/test_service.py',
      '+++ b/test_service.py',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/tests/helpers.py b/tests/helpers.py',
      '--- a/tests/helpers.py',
      '+++ b/tests/helpers.py',
      '@@ -1 +1 @@',
      '-a',
      '+b'
    ].join('\n');

    const sanitized = coder.extractDiff(diff);

    expect(sanitized).toContain('latest.py');
    expect(sanitized).not.toContain('test_service.py');
    expect(sanitized).not.toContain('tests/helpers.py');
  });

  it('reports an empty model response as such instead of a generic format error', () => {
    const coder = new CoderAgent({} as OpenAICompatibleClient);

    expect(() => coder.extractDiff('  \n')).toThrow(/risposta vuota/);
    expect(() => coder.extractDiff('just prose')).toThrow(/Unified Diff valido/);
  });

  it('binds a header-less or mis-pathed diff to the single target file', () => {
    const coder = new CoderAgent({} as OpenAICompatibleClient);
    const headerless = '@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2';
    const wrongPath = '--- a/app/service.py\n+++ b/app/service.py\n@@ -1 +1 @@\n-x\n+y';

    expect(coder.extractDiff(headerless, ['pagination.py'])).toMatch(/^--- a\/pagination\.py\n\+\+\+ b\/pagination\.py\n@@/);
    expect(coder.extractDiff(wrongPath, ['pagination.py'])).toMatch(/^--- a\/pagination\.py\n\+\+\+ b\/pagination\.py\n@@/);
  });

  it('builds a Reviewer fallback from oracle results only, without task-specific hints', async () => {
    const failingClient = {
      completeChat: async () => 'not json'
    } as unknown as OpenAICompatibleClient;
    const report = {
      suitePassed: false,
      failureDetails: [{ testName: 'CollectionError', assertionMessage: 'IndentationError: unexpected indent', stackTrace: '' }]
    } as unknown as TestExecutionReport;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const feedback = await new ReviewerAgent(failingClient).review([], report, false, ['pagination.py']);
    const serialized = JSON.stringify(feedback);

    expect(feedback.targetRemediations[0]?.file).toBe('pagination.py');
    expect(serialized).toContain('IndentationError');
    expect(serialized).not.toContain('return True');
    expect(serialized).not.toContain('service.py');
    expect(serialized).not.toContain('SELECT');
  });
});
