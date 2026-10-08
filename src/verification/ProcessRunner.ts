import { spawn, ChildProcess } from 'node:child_process';

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly executionError?: string;
}

export class ProcessRunner {
  public static execute(
    command: string,
    args: readonly string[],
    cwd: string,
    timeoutMs = 30000
  ): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, [...args], {
          cwd,
          shell: false,
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (err: unknown) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          durationMs: performance.now() - t0,
          executionError: (err as Error).message
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        ProcessRunner.killProcessTree(child);
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString('utf-8');
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          durationMs: performance.now() - t0
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          timedOut: false,
          durationMs: performance.now() - t0,
          executionError: err.message
        });
      });
    });
  }

  private static killProcessTree(child: ChildProcess): void {
    const childPid = child.pid;
    if (childPid === undefined) {
      child.kill('SIGKILL');
      return;
    }

    if (process.platform === 'win32') {
      let killer: ChildProcess;
      try {
        killer = spawn('taskkill', ['/pid', String(childPid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        });
      } catch {
        child.kill('SIGKILL');
        return;
      }

      killer.once('error', () => child.kill('SIGKILL'));
      killer.once('close', (code) => {
        if (code !== 0) child.kill('SIGKILL');
      });
      return;
    }

    try {
      process.kill(-childPid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}
