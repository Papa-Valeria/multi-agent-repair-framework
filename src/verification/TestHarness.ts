import type {
  FunctionalTestOracleConfig,
  OracleResult,
  OracleStatus,
  TestExecutionReport
} from '../types/domain.js';
import { ProcessRunner } from './ProcessRunner.js';
import { pytestResultParser } from './PytestSummaryParser.js';
import type { TestResultParser } from './TestResultParser.js';

export interface FunctionalTestEvaluationParams {
  readonly config?: FunctionalTestOracleConfig;
  readonly required: boolean;
}

export class TestHarness {
  constructor(
    private readonly resultParser: TestResultParser = pytestResultParser
  ) { }

  private reportStateFromStatus(oracleStatus: OracleStatus, timedOut: boolean): {
    readonly suitePassed: boolean;
    readonly oracleFailed: boolean;
    readonly timedOut: boolean;
  } {
    switch (oracleStatus) {
      case 'PASS':
        return {
          suitePassed: true,
          oracleFailed: false,
          timedOut: false
        };

      case 'FAIL':
        return {
          suitePassed: false,
          oracleFailed: false,
          timedOut: false
        };

      case 'NOT_AVAILABLE':
        return {
          suitePassed: false,
          oracleFailed: false,
          timedOut: false
        };

      case 'EXECUTION_ERROR':
        return {
          suitePassed: false,
          oracleFailed: true,
          timedOut
        };

      case 'BLOCKED':
        return {
          suitePassed: false,
          oracleFailed: false,
          timedOut: false
        };
    }
  }

  public async evaluate(
    params: FunctionalTestEvaluationParams
  ): Promise<OracleResult<'FUNCTIONAL_TEST'>> {
    const { config, required } = params;
    const startedAt = performance.now();

    if (config === undefined) {
      return this.createNotAvailableResult(
        required,
        startedAt,
        'Configurazione del test oracle non dichiarata.'
      );
    }

    const oracleFiles = config.oracleFiles
      .map((file) => file.trim())
      .filter((file) => file.length > 0);

    if (
      oracleFiles.length === 0 &&
      !config.allowImplicitDiscovery
    ) {
      return this.createNotAvailableResult(
        required,
        startedAt,
        'Nessun oracleFile esplicito è stato dichiarato e la discovery implicita non è consentita.',
        config
      );
    }

    const implicitDiscoveryUsed = oracleFiles.length === 0;

    const executionArgs = implicitDiscoveryUsed
      ? [...config.args]
      : [...config.args, ...oracleFiles];

    try {
      const result = await ProcessRunner.execute(
        config.command,
        executionArgs,
        {
          cwd: config.cwd,
          timeoutMs: config.timeoutMs,
          envAllowList: config.envAllowList
        }
      );

      const stdout = result.stdout;
      const stderr = result.stderr;
      const output = `${stdout}\n${stderr}`;

      const testSummary = this.resultParser.parse(output);
      const exitCode = result.exitCode;

      const isExpectedPassExit =
        exitCode !== null &&
        config.expectedExitPolicy.passExitCodes.includes(exitCode);

      const isExpectedFailExit =
        exitCode !== null &&
        config.expectedExitPolicy.failExitCodes.includes(exitCode);

      const isExecutionErrorExit =
        exitCode !== null &&
        config.expectedExitPolicy.executionErrorExitCodes.includes(exitCode);

      const isUnexpectedExit =
        exitCode !== null &&
        !isExpectedPassExit &&
        !isExpectedFailExit &&
        !isExecutionErrorExit;

      const isFunctionalTestFailure =
        isExpectedFailExit &&
        testSummary !== null &&
        !testSummary.zeroTestsCollected &&
        (
          testSummary.failedTests > 0 ||
          testSummary.errorTests > 0
        );

      const noOutput = !output.trim();

      const oracleFailureReason = result.timedOut
        ? result.executionError
          ? `Il test runner ha superato il timeout configurato di ${config.timeoutMs} ms: ${result.executionError}`
          : `Il test runner ha superato il timeout configurato di ${config.timeoutMs} ms.`
        : result.executionError
          ? `Impossibile avviare o completare il test runner: ${result.executionError}`
          : exitCode === null
            ? 'Il test runner è terminato senza un codice di uscita valido.'
            : noOutput
              ? 'Il test runner non ha prodotto alcun output.'
              : isExecutionErrorExit
                ? `Il test runner è terminato con exit code ${exitCode}, classificato dalla policy come errore di esecuzione.`
                : isUnexpectedExit
                  ? `Il test runner è terminato con exit code ${exitCode}, non previsto dalla expected exit policy.`
                  : testSummary === null
                    ? 'Il test runner non ha prodotto un riepilogo dei test valido.'
                    : testSummary.zeroTestsCollected
                      ? 'Il test runner è stato eseguito ma non ha raccolto alcun test.'
                      : isExpectedPassExit &&
                        (
                          testSummary.failedTests > 0 ||
                          testSummary.errorTests > 0
                        )
                        ? 'Il runner ha restituito un exit code di successo ma il riepilogo contiene test falliti o errori.'
                        : isExpectedFailExit &&
                          !isFunctionalTestFailure
                          ? `Il runner ha restituito l’exit code di fallimento ${exitCode}, ma il riepilogo non contiene evidenze valide di test falliti.`
                          : undefined;

      const oracleFailed = oracleFailureReason !== undefined;

      const isSuccess =
        isExpectedPassExit &&
        !result.timedOut &&
        !oracleFailed &&
        testSummary !== null &&
        testSummary.passedTests > 0 &&
        testSummary.failedTests === 0 &&
        testSummary.skippedTests === 0 &&
        testSummary.xfailedTests === 0 &&
        testSummary.xpassedTests === 0 &&
        testSummary.errorTests === 0 &&
        testSummary.passedTests === testSummary.totalTests;

      const hasConvergencePolicyViolation =
        testSummary !== null &&
        !isSuccess &&
        !oracleFailed;

      const failureDetails: Array<{
        testName: string;
        assertionMessage: string;
        stackTrace: string;
      }> = [];

      if (!isSuccess) {
        if (result.timedOut) {
          failureDetails.push({
            testName: 'ExecutionTimeout',
            assertionMessage:
              `Execution Timeout: execution exceeded ${config.timeoutMs} ms threshold`,
            stackTrace: stderr.trim()
              ? stderr.slice(-1500)
              : stdout.slice(-1500)
          });
        } else if (oracleFailed) {
          failureDetails.push({
            testName: 'OracleExecutionFailure',
            assertionMessage:
              oracleFailureReason ??
              'Oracle execution failure non specificato.',
            stackTrace: stderr.trim()
              ? stderr.slice(-1500)
              : stdout.slice(-1500)
          });
        } else {
          const errorLines = `${stderr}\n${stdout}`
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(
              (line) =>
                line.includes('FAILED') ||
                line.includes('FAIL:') ||
                line.includes('AssertionError') ||
                /^E\s+assert\b/.test(line)
            );

          const policyMessage = hasConvergencePolicyViolation
            ? `Suite non conforme: ` +
            `${testSummary.passedTests} passed, ` +
            `${testSummary.failedTests} failed, ` +
            `${testSummary.skippedTests} skipped, ` +
            `${testSummary.xfailedTests} xfailed, ` +
            `${testSummary.xpassedTests} xpassed, ` +
            `${testSummary.errorTests} errors.`
            : undefined;

          const observedFailure =
            errorLines.slice(0, 4).join('; ') ||
            policyMessage ||
            (
              isFunctionalTestFailure
                ? `Il test runner ha eseguito gli oracle e rilevato uno o più fallimenti o errori con exit code ${exitCode}.`
                : 'Asserzione o runtime failure rilevato.'
            );

          failureDetails.push({
            testName: hasConvergencePolicyViolation
              ? 'TestSuiteNonConformity'
              : 'FunctionalSuiteFailure',
            assertionMessage:
              `Test oracle failure: ${observedFailure} ` +
              `Le asserzioni nei file di test sono evidenza immutabile del comportamento atteso; ` +
              `la correzione deve essere applicata esclusivamente al codice sorgente target.`,
            stackTrace: stderr.trim()
              ? stderr.slice(-1500)
              : stdout.slice(-1500)
          });
        }
      }

      const oracleStatus: OracleStatus = oracleFailed
        ? 'EXECUTION_ERROR'
        : isSuccess
          ? 'PASS'
          : 'FAIL';

      const reportState = this.reportStateFromStatus(oracleStatus, result.timedOut);

      const report: TestExecutionReport = {
        oracleStatus,
        command: config.command,
        args: executionArgs,
        cwd: config.cwd,
        timeoutMs: config.timeoutMs,
        envAllowList: config.envAllowList,
        oracleFilesExecuted: oracleFiles,
        implicitDiscoveryUsed,
        expectedExitPolicy: config.expectedExitPolicy,
        exitCode,
        suitePassed: reportState.suitePassed,
        timedOut: reportState.timedOut,
        oracleFailed: reportState.oracleFailed,
        ...(oracleFailureReason
          ? { oracleFailureReason }
          : {}),
        totalTests: testSummary?.totalTests ?? 0,
        passedTests: testSummary?.passedTests ?? 0,
        failedTests: testSummary?.failedTests ?? 0,
        skippedTests: testSummary?.skippedTests ?? 0,
        xfailedTests: testSummary?.xfailedTests ?? 0,
        xpassedTests: testSummary?.xpassedTests ?? 0,
        errorTests: testSummary?.errorTests ?? 0,
        passRate:
          testSummary !== null &&
            testSummary.totalTests > 0
            ? testSummary.passedTests /
            testSummary.totalTests
            : 0,
        durationMs: result.durationMs,
        failureDetails,
        stdout,
        stderr,
        rawStdout: result.stdout,
        rawStderr: result.stderr,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        executionDurationMs: result.durationMs
      };

      const summary =
        oracleStatus === 'PASS'
          ? `La suite funzionale ha superato ${report.passedTests}/${report.totalTests} test.`
          : oracleStatus === 'FAIL'
            ? `La suite funzionale non è conforme: ` +
            `${report.failedTests} failed, ` +
            `${report.errorTests} errors, ` +
            `${report.skippedTests} skipped, ` +
            `${report.xfailedTests} xfailed e ` +
            `${report.xpassedTests} xpassed.`
            : report.oracleFailureReason ??
            'Il test runner non ha completato correttamente l’esecuzione.';

      return {
        oracle: 'FUNCTIONAL_TEST',
        status: oracleStatus,
        required,
        durationMs: performance.now() - startedAt,
        summary,
        evidence: {
          report
        }
      };
    } catch (error: unknown) {
      const executionError =
        error instanceof Error
          ? error.message
          : String(error);

      const durationMs = performance.now() - startedAt;
      const reportState = this.reportStateFromStatus('EXECUTION_ERROR', false);
      const report: TestExecutionReport = {
        oracleStatus: 'EXECUTION_ERROR',
        command: config.command,
        args: executionArgs,
        cwd: config.cwd,
        timeoutMs: config.timeoutMs,
        envAllowList: config.envAllowList,
        oracleFilesExecuted: oracleFiles,
        implicitDiscoveryUsed,
        expectedExitPolicy: config.expectedExitPolicy,
        exitCode: null,
        suitePassed: reportState.suitePassed,
        timedOut: reportState.timedOut,
        oracleFailed: reportState.oracleFailed,
        oracleFailureReason: executionError,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        xfailedTests: 0,
        xpassedTests: 0,
        errorTests: 0,
        passRate: 0,
        durationMs,
        failureDetails: [
          {
            testName: 'OracleExecutionFailure',
            assertionMessage: executionError,
            stackTrace:
              error instanceof Error
                ? error.stack ?? error.message
                : executionError
          }
        ],
        stdout: '',
        stderr: '',
        rawStdout: '',
        rawStderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        executionDurationMs: durationMs

      };

      return {
        oracle: 'FUNCTIONAL_TEST',
        status: 'EXECUTION_ERROR',
        required,
        durationMs,
        summary:
          `Il test runner non ha completato correttamente ` +
          `l’esecuzione: ${executionError}`,
        evidence: {
          report
        }
      };
    }
  }

  private createNotAvailableResult(
    required: boolean,
    startedAt: number,
    summary: string,
    config?: FunctionalTestOracleConfig
  ): OracleResult<'FUNCTIONAL_TEST'> {
    const durationMs = performance.now() - startedAt;
    const reportState = this.reportStateFromStatus('NOT_AVAILABLE', false);
    const report: TestExecutionReport = {
      oracleStatus: 'NOT_AVAILABLE',
      command: config?.command ?? null,
      args: config?.args ?? [],
      cwd: config?.cwd ?? null,
      timeoutMs: config?.timeoutMs ?? null,
      envAllowList: config?.envAllowList ?? [],
      oracleFilesExecuted: [],
      implicitDiscoveryUsed: false,
      expectedExitPolicy:
        config?.expectedExitPolicy ?? null,
      exitCode: null,
      suitePassed: reportState.suitePassed,
      timedOut: reportState.timedOut,
      oracleFailed: reportState.oracleFailed,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      xfailedTests: 0,
      xpassedTests: 0,
      errorTests: 0,
      passRate: 0,
      durationMs,
      failureDetails: [],
      stdout: '',
      stderr: '',
      rawStdout: '',
      rawStderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      executionDurationMs: 0

    };

    return {
      oracle: 'FUNCTIONAL_TEST',
      status: 'NOT_AVAILABLE',
      required,
      durationMs,
      summary,
      evidence: {
        report
      }
    };
  }
}
