import { spawn } from 'node:child_process';

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
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
      const child = spawn(command, [...args], { cwd, shell: false });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString('utf-8');
      });

      child.stderr.on('data', (data: Buffer) => {
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
          exitCode: 1,
          stdout,
          stderr: `${stderr}\n${err.message}`,
          timedOut: false,
          durationMs: performance.now() - t0
        });
      });
    });
  }
}
