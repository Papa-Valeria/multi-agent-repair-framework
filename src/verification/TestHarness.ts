import { ProcessRunner } from './ProcessRunner.js';
import { TestExecutionReport } from '../types/domain.js';
import { parsePytestSummary } from './PytestSummaryParser.js';

export class TestHarness {
  constructor(
    private readonly repoRoot: string,
    private readonly testCommand: string = 'python',
    private readonly testArgs: readonly string[] = ['-B', '-m', 'pytest', '--maxfail=5', '-q']
  ) { }

  public async executeSuite(): Promise<TestExecutionReport> {
    const result = await ProcessRunner.execute(
      this.testCommand,
      this.testArgs,
      this.repoRoot,
      30000
    );

    const stdout = result.stdout;
    const stderr = result.stderr;
    const output = `${stdout}\n${stderr}`;
    const testSummary = parsePytestSummary(output);

    const hasCollectionKeywords =
      /errors? during collection/i.test(output) ||
      /ERROR collecting/i.test(output);

    const isCollectionError =
      result.exitCode === 2 &&
      ((testSummary !== null && testSummary.errorTests > 0) || hasCollectionKeywords);

    const isFunctionalTestFailure =
      (result.exitCode === 1 && testSummary !== null) || isCollectionError;

    const noOutput = !output.trim();

    const oracleFailureReason = result.executionError
      ? `Impossibile avviare il test runner: ${result.executionError}`
      : result.timedOut
        ? undefined
        : result.exitCode === null
          ? 'Il test runner è terminato senza un codice di uscita valido.'
          : noOutput
            ? 'Il test runner non ha prodotto alcun output.'
            : isCollectionError
              ? undefined
              : testSummary === null
                ? 'Il test runner non ha prodotto un riepilogo dei test valido.'
                : result.exitCode === 0 && testSummary.failedTests + testSummary.errorTests > 0
                  ? 'Il runner ha restituito exit code 0 ma il riepilogo contiene test falliti.'
                  : result.exitCode !== 0 && !isFunctionalTestFailure
                    ? `Il test runner è terminato con codice ${result.exitCode} senza un riepilogo valido dei test falliti.`
                    : undefined;

    const oracleFailed = oracleFailureReason !== undefined;

    const isSuccess =
      result.exitCode === 0 &&
      !result.timedOut &&
      !oracleFailed &&
      testSummary !== null &&
      testSummary.passedTests > 0 &&
      testSummary.failedTests === 0 &&
      testSummary.skippedTests === 0 &&
      testSummary.xfailedTests === 0 &&
      testSummary.errorTests === 0 &&
      testSummary.passedTests === testSummary.totalTests;

    const hasConvergencePolicyViolation =
      testSummary !== null && !isSuccess && !oracleFailed && !isCollectionError;

    const failureDetails: Array<{
      testName: string;
      assertionMessage: string;
      stackTrace: string;
    }> = [];

    if (!isSuccess) {
      if (result.timedOut) {
        failureDetails.push({
          testName: 'ExecutionTimeout',
          assertionMessage: 'Execution Timeout: execution exceeded 30s threshold',
          stackTrace: stderr.trim() ? stderr.slice(-1500) : stdout.slice(-1500)
        });
      } else if (oracleFailed) {
        failureDetails.push({
          testName: 'OracleExecutionFailure',
          assertionMessage: oracleFailureReason ?? 'Oracle failure non specificato',
          stackTrace: stderr.trim() ? stderr.slice(-1500) : stdout.slice(-1500)
        });
      } else if (isCollectionError) {
        const collectionErrors = output
          .split(/\r?\n/)
          .filter((line) => /^E\s+\S/.test(line))
          .map((line) => line.replace(/^E\s+/, '').trim());

        failureDetails.push({
          testName: 'CollectionError',
          assertionMessage:
            collectionErrors.slice(0, 4).join('; ') ||
            "Pytest non ha potuto importare i moduli di test dopo l'applicazione della patch.",
          stackTrace: stderr.trim() ? stderr.slice(-1500) : stdout.slice(-1500)
        });
      } else {
        const errorLines = (stderr + '\n' + stdout)
          .split('\n')
          .filter(
            (line) =>
              line.includes('FAILED') ||
              line.includes('FAIL:') ||
              line.includes('AssertionError')
          );

        const policyMessage = hasConvergencePolicyViolation
          ? `Suite non conforme: ${testSummary.passedTests} passed, ${testSummary.failedTests} failed, ${testSummary.skippedTests} skipped, ${testSummary.xfailedTests} xfailed, ${testSummary.errorTests} errors.`
          : undefined;

        failureDetails.push({
          testName: hasConvergencePolicyViolation
            ? 'TestSuiteNonConformity'
            : 'FunctionalSuiteFailure',
          assertionMessage:
            policyMessage ||
            errorLines.slice(0, 3).join('; ') ||
            (isFunctionalTestFailure
              ? 'Pytest ha eseguito i test e rilevato uno o più fallimenti o errori (exit code 1).'
              : 'Asserzione o runtime failure rilevato.'),
          stackTrace: stderr.trim() ? stderr.slice(-1500) : stdout.slice(-1500)
        });
      }
    }

    return {
      exitCode: result.exitCode,
      suitePassed: isSuccess,
      timedOut: result.timedOut,
      oracleFailed,
      ...(oracleFailureReason ? { oracleFailureReason } : {}),
      totalTests: testSummary?.totalTests ?? (isCollectionError ? 1 : 0),
      passedTests: testSummary?.passedTests ?? 0,
      failedTests: testSummary?.failedTests ?? 0,
      skippedTests: testSummary?.skippedTests ?? 0,
      xfailedTests: testSummary?.xfailedTests ?? 0,
      errorTests: testSummary?.errorTests ?? (isCollectionError ? 1 : 0),
      passRate:
        testSummary && testSummary.totalTests > 0
          ? testSummary.passedTests / testSummary.totalTests
          : 0,
      durationMs: result.durationMs,
      failureDetails,
      stdout,
      stderr,
      executionDurationMs: result.durationMs
    };
  }
}
