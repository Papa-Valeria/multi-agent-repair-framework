import { describe, expect, it } from '@jest/globals';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProcessRunner } from '../src/verification/ProcessRunner.js';

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

describe('ProcessRunner deterministic timeout', () => {
  it('kills the command at its deadline and preserves partial output', async () => {
    const result = await ProcessRunner.execute(
      process.execPath,
      ['-e', "process.stdout.write('partial-out\\n'); process.stderr.write('partial-err\\n'); setInterval(() => {}, 1000);"],
      process.cwd(),
      300
    );

    expect(result.timedOut).toBe(true);
    expect(result.stdout).toContain('partial-out');
    expect(result.stderr).toContain('partial-err');
    expect(result.durationMs).toBeGreaterThanOrEqual(250);
  });

  it('kills descendants of the timed-out command', async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'process-runner-tree-'));
    const pidFile = path.join(temporaryDirectory, 'descendant.pid');
    const childScript = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });`,
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
      'setInterval(() => {}, 1000);'
    ].join('');

    try {
      const result = await ProcessRunner.execute(
        process.execPath,
        ['-e', childScript],
        temporaryDirectory,
        500
      );
      const descendantPid = Number(await readFile(pidFile, 'utf8'));

      expect(result.timedOut).toBe(true);
      expect(Number.isInteger(descendantPid)).toBe(true);
      expect(await waitForProcessExit(descendantPid, 3000)).toBe(true);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
