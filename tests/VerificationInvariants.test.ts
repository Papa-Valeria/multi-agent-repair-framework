import {
  assertFunctionalTestResultInvariants,
  assertTestExecutionReportInvariants,
  assertVerificationVerdictInvariants,
  assertWorkbenchSessionInvariants,
  VerificationInvariantError
} from '../src/verification/VerificationInvariants.js';

import {
  DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

import type {
  ComputationalTelemetry,
  OracleResult,
  SastFinding,
  TestExecutionReport,
  VerificationVerdict,
  WorkbenchSessionState
} from '../src/types/domain.js';

function passingReport(): TestExecutionReport {
  return {
    oracleStatus: 'PASS',
    command: 'python',
    args: [
      '-m',
      'pytest',
      '-q',
      'test_service.py'
    ],
    cwd: '.',
    timeoutMs: 30_000,
    envAllowList: ['PATH'],
    oracleFilesExecuted: [
      'test_service.py'
    ],
    implicitDiscoveryUsed: false,
    expectedExitPolicy: {
      passExitCodes: [0],
      failExitCodes: [1],
      executionErrorExitCodes: [
        2,
        3,
        4,
        5
      ]
    },
    exitCode: 0,
    suitePassed: true,
    timedOut: false,
    oracleFailed: false,
    totalTests: 2,
    passedTests: 2,
    failedTests: 0,
    skippedTests: 0,
    xfailedTests: 0,
    xpassedTests: 0,
    errorTests: 0,
    passRate: 1,
    durationMs: 10,
    failureDetails: [],
    stdout: '2 passed',
    stderr: '',
    rawStdout: '2 passed',
    rawStderr: '',
    executionDurationMs: 10
  };
}

function failingReportWithFailedTest():
  TestExecutionReport {
  return {
    ...passingReport(),
    oracleStatus: 'FAIL',
    exitCode: 1,
    suitePassed: false,
    totalTests: 2,
    passedTests: 1,
    failedTests: 1,
    passRate: 0.5,
    failureDetails: [
      {
        testName: 'test_service',
        assertionMessage:
          'Expected True but received False',
        stackTrace: 'AssertionError'
      }
    ],
    stdout: '1 passed, 1 failed',
    rawStdout: '1 passed, 1 failed'
  };
}

function failingReportWithSkippedTest():
  TestExecutionReport {
  return {
    ...passingReport(),
    oracleStatus: 'FAIL',
    exitCode: 0,
    suitePassed: false,
    totalTests: 2,
    passedTests: 1,
    skippedTests: 1,
    passRate: 0.5,
    failureDetails: [
      {
        testName: 'TestSuiteNonConformity',
        assertionMessage:
          'Suite non conforme: 1 skipped.',
        stackTrace: ''
      }
    ],
    stdout: '1 passed, 1 skipped',
    rawStdout: '1 passed, 1 skipped'
  };
}

function applicabilityResult():
  OracleResult<'APPLICABILITY'> {
  return {
    oracle: 'APPLICABILITY',
    status: 'PASS',
    required: true,
    durationMs: 1,
    summary: 'Patch applicabile.',
    evidence: {
      applyMode: 'GIT',
      patchHash: 'patch-hash'
    }
  };
}

function buildSyntaxResult():
  OracleResult<'BUILD_SYNTAX'> {
  return {
    oracle: 'BUILD_SYNTAX',
    status: 'PASS',
    required: true,
    durationMs: 1,
    summary: 'Build valida.',
    evidence: {
      command: 'python',
      args: [
        '-m',
        'py_compile',
        'service.py'
      ],
      cwd: '.',
      timeoutMs: 30_000,
      envAllowList: ['PATH'],
      exitCode: 0,
      timedOut: false,
      stdout: '',
      stderr: ''
    }
  };
}

function semgrepResult(
  findings: readonly SastFinding[] = [],
  durationMs = 1
): OracleResult<'SEMGREP'> {
  return {
    oracle: 'SEMGREP',
    status:
      findings.length > 0
        ? 'FAIL'
        : 'PASS',
    required: true,
    durationMs,
    summary:
      findings.length > 0
        ? 'Finding rilevati.'
        : 'Nessun finding.',
    evidence: {
      findings,
      scannedFiles: ['service.py']
    }
  };
}

function functionalTestResult(
  report: TestExecutionReport =
    passingReport(),
  status:
    OracleResult<'FUNCTIONAL_TEST'>['status'] =
    report.oracleStatus
): OracleResult<'FUNCTIONAL_TEST'> {
  return {
    oracle: 'FUNCTIONAL_TEST',
    status,
    required: true,
    durationMs: report.durationMs,
    summary:
      'Suite funzionale completata.',
    evidence: {
      report
    }
  };
}

function passingVerdict():
  VerificationVerdict {
  const functionalTest =
    functionalTestResult();

  const semgrep =
    semgrepResult();

  return {
    verified: true,
    oracleResults: [
      applicabilityResult(),
      buildSyntaxResult(),
      semgrep,
      functionalTest
    ],
    sastFindings:
      semgrep.evidence.findings,
    semgrepDurationMs:
      semgrep.durationMs,
    testReport:
      functionalTest.evidence.report
  };
}

function telemetry():
  ComputationalTelemetry {
  return {
    promptTokens: 0,
    completionTokens: 0,
    inferenceDurationMs: 0,
    oracleDurationMs: 0,
    orchestrationOverheadMs: 0,
    totalDurationMs: 0,
    agentUsage: {
      CODER: {
        promptTokens: 0,
        completionTokens: 0,
        inferenceDurationMs: 0
      },
      REVIEWER: {
        promptTokens: 0,
        completionTokens: 0,
        inferenceDurationMs: 0
      }
    }
  };
}

function convergedSession(
  verdict: VerificationVerdict =
    passingVerdict()
): WorkbenchSessionState {
  return {
    taskId: 'task-1',
    issueSpec:
      'Correggere il comportamento target.',
    category: 'REPAIR',
    status: 'CONVERGED',
    targetFiles: ['service.py'],
    testFiles: ['test_service.py'],
    currentIteration: 1,
    maxIterations: 3,
    iterations: [
      {
        iteration: 1,
        patchDiff:
          'diff --git a/service.py b/service.py',
        patchHash: 'patch-hash',
        isApplicable: true,
        verification: verdict,
        telemetry: telemetry(),
        applyMode: 'GIT',
        fuzzyFallbackUsed: false
      }
    ],
    finalPatch:
      'diff --git a/service.py b/service.py',
    cumulativeTelemetry: telemetry(),
    terminationReason:
      'ALL_REQUIRED_GATES_PASSED: ' +
      'All required verification gates passed.'
  };
}

describe(
  'VerificationInvariants',
  () => {
    it(
      'accetta un report PASS coerente',
      () => {
        expect(() =>
          assertTestExecutionReportInvariants(
            passingReport()
          )
        ).not.toThrow();
      }
    );

    it(
      'rifiuta PASS con suitePassed=false',
      () => {
        const report:
          TestExecutionReport = {
          ...passingReport(),
          suitePassed: false
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta PASS con exitCode non ammesso dalla expected exit policy',
      () => {
        const report:
          TestExecutionReport = {
          ...passingReport(),
          exitCode: 2
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta EXECUTION_ERROR con oracleFailed=false',
      () => {
        const report:
          TestExecutionReport = {
          ...passingReport(),
          oracleStatus:
            'EXECUTION_ERROR',
          exitCode: null,
          suitePassed: false,
          oracleFailed: false,
          totalTests: 0,
          passedTests: 0,
          passRate: 0
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'accetta FAIL con failExitCode e failedTests',
      () => {
        expect(() =>
          assertTestExecutionReportInvariants(
            failingReportWithFailedTest()
          )
        ).not.toThrow();
      }
    );

    it(
      'accetta FAIL con passExitCode e skippedTests',
      () => {
        expect(() =>
          assertTestExecutionReportInvariants(
            failingReportWithSkippedTest()
          )
        ).not.toThrow();
      }
    );

    it(
      'rifiuta FAIL con exitCode nullo',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithFailedTest(),
          exitCode: null
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta FAIL senza expectedExitPolicy',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithFailedTest(),
          expectedExitPolicy: null
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta FAIL con exitCode non previsto dalla policy',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithFailedTest(),
          exitCode: 99
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta FAIL con executionErrorExitCode',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithFailedTest(),
          exitCode: 2
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta FAIL con failExitCode ma senza failedTests o errorTests',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithFailedTest(),
          passedTests: 2,
          failedTests: 0,
          errorTests: 0,
          passRate: 1,
          failureDetails: []
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta FAIL con passExitCode ma senza violazioni della strict policy',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithSkippedTest(),
          passedTests: 2,
          skippedTests: 0,
          xfailedTests: 0,
          xpassedTests: 0,
          passRate: 1,
          failureDetails: []
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta FAIL con passExitCode e failedTests',
      () => {
        const report:
          TestExecutionReport = {
          ...failingReportWithFailedTest(),
          exitCode: 0
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta totalTests diverso dalla somma degli outcome',
      () => {
        const report:
          TestExecutionReport = {
          ...passingReport(),
          totalTests: 3
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta passRate diverso da passedTests diviso totalTests',
      () => {
        const report:
          TestExecutionReport = {
          ...passingReport(),
          passRate: 0.5
        };

        expect(() =>
          assertTestExecutionReportInvariants(
            report
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta la divergenza tra OracleResult.status e report.oracleStatus',
      () => {
        const result =
          functionalTestResult(
            passingReport(),
            'FAIL'
          );

        expect(() =>
          assertFunctionalTestResultInvariants(
            result
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'accetta un VerificationVerdict completo e convergente',
      () => {
        expect(() =>
          assertVerificationVerdictInvariants(
            passingVerdict(),
            DEFAULT_ORACLE_PROFILE,
            true
          )
        ).not.toThrow();
      }
    );

    it(
      'rifiuta direttamente un verdict.testReport internamente incoerente',
      () => {
        const baseVerdict =
          passingVerdict();

        const invalidReport:
          TestExecutionReport = {
          ...baseVerdict.testReport,
          totalTests: 3
        };

        const verdict:
          VerificationVerdict = {
          ...baseVerdict,
          testReport: invalidReport
        };

        expect(() =>
          assertVerificationVerdictInvariants(
            verdict,
            DEFAULT_ORACLE_PROFILE,
            true
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta verdict.testReport diverso dal report del Functional Test Oracle',
      () => {
        const baseVerdict =
          passingVerdict();

        const differentButValidReport:
          TestExecutionReport = {
          ...baseVerdict.testReport,
          stdout:
            'output differente ma report valido'
        };

        const verdict:
          VerificationVerdict = {
          ...baseVerdict,
          testReport:
            differentButValidReport
        };

        expect(() =>
          assertVerificationVerdictInvariants(
            verdict,
            DEFAULT_ORACLE_PROFILE,
            true
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta sastFindings diversi dai finding del Semgrep Oracle',
      () => {
        const baseVerdict =
          passingVerdict();

        const projectedFinding:
          SastFinding = {
          ruleId:
            'test.security.rule',
          path: 'service.py',
          startLine: 1,
          endLine: 1,
          severity: 'ERROR',
          message:
            'Finding presente soltanto nella proiezione.',
          cweHierarchy: ['CWE-79']
        };

        const verdict:
          VerificationVerdict = {
          ...baseVerdict,
          sastFindings: [
            projectedFinding
          ]
        };

        expect(() =>
          assertVerificationVerdictInvariants(
            verdict,
            DEFAULT_ORACLE_PROFILE,
            true
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta semgrepDurationMs diversa dalla durata del Semgrep Oracle',
      () => {
        const baseVerdict =
          passingVerdict();

        const verdict:
          VerificationVerdict = {
          ...baseVerdict,
          semgrepDurationMs: 99
        };

        expect(() =>
          assertVerificationVerdictInvariants(
            verdict,
            DEFAULT_ORACLE_PROFILE,
            true
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta verified=false quando OracleDecision è convergente',
      () => {
        const verdict:
          VerificationVerdict = {
          ...passingVerdict(),
          verified: false
        };

        expect(() =>
          assertVerificationVerdictInvariants(
            verdict,
            DEFAULT_ORACLE_PROFILE,
            true
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'rifiuta una sessione CONVERGED con verification.verified=false',
      () => {
        const invalidVerdict:
          VerificationVerdict = {
          ...passingVerdict(),
          verified: false
        };

        expect(() =>
          assertWorkbenchSessionInvariants(
            convergedSession(
              invalidVerdict
            ),
            DEFAULT_ORACLE_PROFILE
          )
        ).toThrow(
          VerificationInvariantError
        );
      }
    );

    it(
      'accetta una sessione CONVERGED coerente',
      () => {
        expect(() =>
          assertWorkbenchSessionInvariants(
            convergedSession(),
            DEFAULT_ORACLE_PROFILE
          )
        ).not.toThrow();
      }
    );
  }
);
