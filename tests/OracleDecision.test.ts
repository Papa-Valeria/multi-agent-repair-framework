import {
  DEFAULT_ORACLE_PROFILE,
  decideOracleResults
} from '../src/verification/OracleDecision.js';

import type {
  OracleResult,
  OracleStatus
} from '../src/types/domain.js';

function applicabilityResult(
  status: OracleStatus = 'PASS',
  required = true
): OracleResult<'APPLICABILITY'> {
  return {
    oracle: 'APPLICABILITY',
    status,
    required,
    durationMs: 1,
    summary: `APPLICABILITY: ${status}`,
    evidence: {
      applyMode:
        status === 'PASS'
          ? 'GIT'
          : 'NOT_APPLICABLE'
    }
  };
}

function buildSyntaxResult(
  status: OracleStatus = 'PASS',
  required = true
): OracleResult<'BUILD_SYNTAX'> {
  return {
    oracle: 'BUILD_SYNTAX',
    status,
    required,
    durationMs: 1,
    summary: `BUILD_SYNTAX: ${status}`,
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
      exitCode:
        status === 'PASS'
          ? 0
          : status === 'FAIL'
            ? 1
            : null,
      timedOut: false,
      stdout: '',
      stderr: ''
    }
  };
}

function semgrepResult(
  status: OracleStatus = 'PASS',
  required = true
): OracleResult<'SEMGREP'> {
  return {
    oracle: 'SEMGREP',
    status,
    required,
    durationMs: 1,
    summary: `SEMGREP: ${status}`,
    evidence: {
      findings: [],
      scannedFiles: ['service.py']
    }
  };
}

function functionalTestResult(
  status: OracleStatus = 'PASS',
  required = true
): OracleResult<'FUNCTIONAL_TEST'> {
  return {
    oracle: 'FUNCTIONAL_TEST',
    status,
    required,
    durationMs: 1,
    summary: `FUNCTIONAL_TEST: ${status}`,
    evidence: {
      report: {
        oracleStatus: status,
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
        exitCode:
          status === 'PASS'
            ? 0
            : status === 'FAIL'
              ? 1
              : null,
        suitePassed:
          status === 'PASS',
        timedOut: false,
        oracleFailed:
          status === 'EXECUTION_ERROR',
        totalTests:
          status === 'PASS' ||
            status === 'FAIL'
            ? 1
            : 0,
        passedTests:
          status === 'PASS'
            ? 1
            : 0,
        failedTests:
          status === 'FAIL'
            ? 1
            : 0,
        skippedTests: 0,
        xfailedTests: 0,
        xpassedTests: 0,
        errorTests: 0,
        passRate:
          status === 'PASS'
            ? 1
            : 0,
        durationMs: 1,
        failureDetails: [],
        stdout: '',
        stderr: '',
        rawStdout: '',
        rawStderr: '',
        executionDurationMs: 1
      }
    }
  };
}

function completePassingResults():
  readonly OracleResult[] {
  return [
    applicabilityResult(),
    buildSyntaxResult(),
    semgrepResult(),
    functionalTestResult()
  ];
}

describe(
  'decideOracleResults - invarianti del profilo',
  () => {
    it(
      'converge con tutti gli oracle obbligatori presenti una volta e in PASS',
      () => {
        const decision = decideOracleResults(
          completePassingResults(),
          DEFAULT_ORACLE_PROFILE
        );

        expect(decision.converged)
          .toBe(true);

        expect(decision.shouldRefine)
          .toBe(false);

        expect(
          decision.hasInvariantViolation
        ).toBe(false);

        expect(
          decision.missingRequiredOracles
        ).toEqual([]);

        expect(
          decision.duplicateOracles
        ).toEqual([]);

        expect(
          decision.requirementMismatches
        ).toEqual([]);
      }
    );

    it(
      'non converge quando manca un oracle obbligatorio',
      () => {
        const results =
          completePassingResults().filter(
            (result) =>
              result.oracle !==
              'FUNCTIONAL_TEST'
          );

        const decision = decideOracleResults(
          results,
          DEFAULT_ORACLE_PROFILE
        );

        expect(decision.converged)
          .toBe(false);

        expect(decision.shouldRefine)
          .toBe(false);

        expect(
          decision.hasInvariantViolation
        ).toBe(true);

        expect(
          decision.missingRequiredOracles
        ).toEqual([
          'FUNCTIONAL_TEST'
        ]);
      }
    );

    it(
      'non converge quando un oracle è duplicato',
      () => {
        const results:
          readonly OracleResult[] = [
            ...completePassingResults(),
            semgrepResult()
          ];

        const decision = decideOracleResults(
          results,
          DEFAULT_ORACLE_PROFILE
        );

        expect(decision.converged)
          .toBe(false);

        expect(decision.shouldRefine)
          .toBe(false);

        expect(
          decision.hasInvariantViolation
        ).toBe(true);

        expect(
          decision.duplicateOracles
        ).toEqual(['SEMGREP']);
      }
    );

    it(
      'non converge quando required non coincide con il profilo',
      () => {
        const results:
          readonly OracleResult[] = [
            applicabilityResult(),
            buildSyntaxResult(),
            semgrepResult('PASS', false),
            functionalTestResult()
          ];

        const decision = decideOracleResults(
          results,
          DEFAULT_ORACLE_PROFILE
        );

        expect(decision.converged)
          .toBe(false);

        expect(decision.shouldRefine)
          .toBe(false);

        expect(
          decision.hasInvariantViolation
        ).toBe(true);

        expect(
          decision.requirementMismatches
        ).toEqual(['SEMGREP']);
      }
    );
  }
);
