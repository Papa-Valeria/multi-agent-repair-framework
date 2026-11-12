import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly executionError?: string;
}

export interface ProcessExecutionOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly envAllowList: readonly string[];
}

interface OutputAppendResult {
  readonly output: string;
  readonly truncated: boolean;
}

export class ProcessRunner {
  private static readonly KILL_GRACE_PERIOD_MS = 5_000;
  private static readonly MAX_OUTPUT_LENGTH = 1_000_000;

  public static execute(command: string, args: readonly string[], options: ProcessExecutionOptions): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const startedAt = performance.now();
      const {
        cwd,
        timeoutMs,
        envAllowList
      } = options;
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          durationMs: performance.now() - startedAt,
          executionError: `Timeout non valido: ${timeoutMs}.`
        });
        return;
      }
      const env = ProcessRunner.buildAllowedEnvironment(envAllowList);
      let child: ReturnType<typeof spawn>;

      try {

        child = spawn(command, [...args], {
          cwd,
          shell: false,
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env
        });
      } catch (error: unknown) {
        const executionError = ProcessRunner.errorMessage(error);

        resolve({
          exitCode: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          timedOut: false,
          durationMs: performance.now() - startedAt,
          executionError
        });

        return;
      }

      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;
      let settled = false;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let killGraceTimer: NodeJS.Timeout | undefined;

      const finish = (result: Omit<ProcessResult, 'durationMs'>): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutTimer !== undefined) {
          clearTimeout(timeoutTimer);
        }
        if (killGraceTimer !== undefined) {
          clearTimeout(killGraceTimer);
        }
        resolve({
          ...result,
          durationMs: performance.now() - startedAt
        });
      };

      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          ProcessRunner.killProcessTree(child);
        } catch (error: unknown) {
          const executionError = ProcessRunner.errorMessage(error);
          finish({
            exitCode: null,
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated,
            timedOut: true,
            executionError: `Impossibile terminare il processo dopo il timeout: ${executionError}`
          });
          return;
        }
        killGraceTimer = setTimeout(() => {
          finish({
            exitCode: null,
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated,
            timedOut: true,
            executionError: 'Il processo non ha confermato la terminazione entro il periodo di grazia successivo al timeout.'
          });
        }, ProcessRunner.KILL_GRACE_PERIOD_MS);
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        const appended = ProcessRunner.appendOutput(stdout, data.toString('utf-8'));
        stdout = appended.output;
        stdoutTruncated = stdoutTruncated || appended.truncated;
      }
      );

      child.stderr?.on('data', (data: Buffer) => {
        const appended = ProcessRunner.appendOutput(stderr, data.toString('utf-8'));
        stderr = appended.output;
        stderrTruncated = stderrTruncated || appended.truncated;
      }
      );

      child.once('error', (error) => {
        const errorOutput = stderr.length > 0 ? `\n${error.message}` : error.message;
        const appended = ProcessRunner.appendOutput(stderr, errorOutput);
        stderr = appended.output;
        stderrTruncated = stderrTruncated || appended.truncated;
        finish({
          exitCode: null,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          timedOut,
          executionError: error.message
        });
      });

      child.once('close', (code) => {
        finish({
          exitCode: code,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          timedOut
        });
      });
    });
  }

  private static buildAllowedEnvironment(
    allowlist: readonly string[]
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};

    const canonicalNames =
      new Set<string>();

    for (
      const name of allowlist
    ) {
      const canonicalName =
        ProcessRunner.canonicalizeEnvironmentName(
          name
        );

      if (
        canonicalName.length === 0
      ) {
        continue;
      }

      canonicalNames.add(
        canonicalName
      );
    }

    for (
      const canonicalName of canonicalNames
    ) {
      const value =
        ProcessRunner.findEnvironmentValue(
          canonicalName
        );

      if (
        value !== undefined
      ) {
        env[canonicalName] =
          value;
      }
    }

    return env;
  }

  private static canonicalizeEnvironmentName(
    name: string
  ): string {
    return name
      .trim()
      .toUpperCase();
  }

  private static findEnvironmentValue(
    canonicalName: string
  ): string | undefined {
    const exactValue =
      process.env[canonicalName];

    if (
      exactValue !== undefined
    ) {
      return exactValue;
    }

    const matchingNames =
      Object.keys(
        process.env
      )
        .filter(
          (name) =>
            name
              .toUpperCase() ===
            canonicalName
        )
        .sort(
          (
            left,
            right
          ) =>
            left.localeCompare(
              right
            )
        );

    for (
      const matchingName of matchingNames
    ) {
      const value =
        process.env[
        matchingName
        ];

      if (
        value !== undefined
      ) {
        return value;
      }
    }

    return undefined;
  }

  private static appendOutput(
    current: string,
    chunk: string
  ): OutputAppendResult {
    if (
      current.length >=
      ProcessRunner.MAX_OUTPUT_LENGTH
    ) {
      return {
        output:
          current,

        truncated:
          chunk.length > 0
      };
    }

    const marker =
      '\n[output truncated]';

    const remaining =
      ProcessRunner.MAX_OUTPUT_LENGTH -
      current.length;

    if (
      chunk.length <= remaining
    ) {
      return {
        output:
          current + chunk,

        truncated:
          false
      };
    }

    if (
      remaining <= marker.length
    ) {
      return {
        output:
          current +
          marker.slice(
            0,
            remaining
          ),

        truncated:
          true
      };
    }

    const availableForChunk =
      remaining -
      marker.length;

    return {
      output:
        current +
        chunk.slice(
          0,
          availableForChunk
        ) +
        marker,

      truncated:
        true
    };
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

  private static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
