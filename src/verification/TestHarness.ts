import { ProcessRunner } from './ProcessRunner.js';
import { TestExecutionReport } from '../types/domain.js';

export class TestHarness {
  constructor(
    private readonly repoRoot: string,
    private readonly testCommand: string = 'python',
    private readonly testArgs: readonly string[] = ['-B', '-m', 'pytest', '--maxfail=5', '-q']
  ) {}

  public async executeSuite(): Promise<TestExecutionReport> {
    const result = await ProcessRunner.execute(
      this.testCommand,
      this.testArgs,
      this.repoRoot,
      30000 // Timeout deterministico T_timeout = 30s
    );

    const isSuccess = result.exitCode === 0 && !result.timedOut;
    const stdout = result.stdout;
    const stderr = result.stderr;

    // Parsing euristico agnostico per report fallimenti
    const failureDetails: Array<{
      testName: string;
      assertionMessage: string;
      stackTrace: string;
    }> = [];

    if (!isSuccess) {
      if (result.timedOut) {
        failureDetails.push({
          testName: 'ExecutionTimeout',
          assertionMessage: 'La suite di test ha superato la soglia di 30 secondi (SIGKILL emesso).',
          stackTrace: 'Timeout deterministico intercettato dal Test Harness.'
        });
      } else {
        const errorLines = (stderr + '\n' + stdout)
          .split('\n')
          .filter((line) => line.includes('FAILED') || line.includes('FAIL:') || line.includes('AssertionError'));

        failureDetails.push({
          testName: 'FunctionalSuiteFailure',
          assertionMessage: errorLines.slice(0, 3).join('; ') || 'Asserzione o runtime failure rilevato.',
          stackTrace: stderr.trim() ? stderr.slice(-1500) : stdout.slice(-1500)
        });
      }
    }

    return {
      suitePassed: isSuccess,
      totalTests: isSuccess ? 1 : failureDetails.length,
      passedTests: isSuccess ? 1 : 0,
      failedTests: isSuccess ? 0 : failureDetails.length,
      failureDetails,
      rawStderr: stderr,
      executionDurationMs: result.durationMs
    };
  }
}
