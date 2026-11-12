import {
    afterEach,
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import type {
    FunctionalTestOracleConfig,
    OracleResult
} from '../src/types/domain.js';

import {
    ProcessRunner,
    type ProcessResult
} from '../src/verification/ProcessRunner.js';

import {
    TestHarness
} from '../src/verification/TestHarness.js';

import {
    assertFunctionalTestResultInvariants
} from '../src/verification/VerificationInvariants.js';

const config:
    FunctionalTestOracleConfig = {
    command:
        'pytest',

    args:
        [],

    cwd:
        '.',

    timeoutMs:
        5_000,

    oracleFiles: [
        'tests/test_target.py'
    ],

    envAllowList:
        [],

    expectedExitPolicy: {
        passExitCodes: [
            0
        ],

        failExitCodes: [
            1
        ],

        executionErrorExitCodes: [
            2,
            3,
            4,
            5
        ]
    },

    allowImplicitDiscovery:
        false
};

const createProcessResult = (
    overrides:
        Partial<ProcessResult> = {}
): ProcessResult => ({
    exitCode:
        0,

    stdout:
        '1 passed in 0.01s',

    stderr:
        '',

    stdoutTruncated:
        false,

    stderrTruncated:
        false,

    timedOut:
        false,

    durationMs:
        10,

    ...overrides
});

const evaluateWithResult = async (
    result:
        ProcessResult
): Promise<
    OracleResult<'FUNCTIONAL_TEST'>
> => {
    jest.spyOn(
        ProcessRunner,
        'execute'
    ).mockResolvedValue(
        result
    );

    const harness =
        new TestHarness();

    return harness.evaluate({
        config,
        required:
            true
    });
};

const expectStrictFailure = (
    result:
        OracleResult<'FUNCTIONAL_TEST'>,
    expectedCounts: {
        readonly totalTests: number;
        readonly passedTests: number;
        readonly skippedTests: number;
        readonly xfailedTests: number;
        readonly xpassedTests: number;
    }
): void => {
    expect(
        result.status
    ).toBe(
        'FAIL'
    );

    expect(
        result.evidence.report.oracleStatus
    ).toBe(
        'FAIL'
    );

    expect(
        result.evidence.report.suitePassed
    ).toBe(
        false
    );

    expect(
        result.evidence.report.oracleFailed
    ).toBe(
        false
    );

    expect(
        result.evidence.report.timedOut
    ).toBe(
        false
    );

    expect(
        result.evidence.report.exitCode
    ).toBe(
        0
    );

    expect(
        result.evidence.report.totalTests
    ).toBe(
        expectedCounts.totalTests
    );

    expect(
        result.evidence.report.passedTests
    ).toBe(
        expectedCounts.passedTests
    );

    expect(
        result.evidence.report.failedTests
    ).toBe(
        0
    );

    expect(
        result.evidence.report.errorTests
    ).toBe(
        0
    );

    expect(
        result.evidence.report.skippedTests
    ).toBe(
        expectedCounts.skippedTests
    );

    expect(
        result.evidence.report.xfailedTests
    ).toBe(
        expectedCounts.xfailedTests
    );

    expect(
        result.evidence.report.xpassedTests
    ).toBe(
        expectedCounts.xpassedTests
    );

    expect(
        result.evidence.report
            .failureDetails
    ).toHaveLength(
        1
    );

    expect(
        result.evidence.report
            .failureDetails[0]
            ?.testName
    ).toBe(
        'TestSuiteNonConformity'
    );

    expect(
        result.evidence.report
            .failureDetails[0]
            ?.assertionMessage
    ).toContain(
        'Suite non conforme'
    );

    expect(
        () =>
            assertFunctionalTestResultInvariants(
                result
            )
    ).not.toThrow();
};

afterEach(
    () => {
        jest.restoreAllMocks();
    }
);

describe(
    'BE-P1-14 - Strict pytest policy',
    () => {
        it(
            'classifica PASS una suite con tutti i test superati',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                0,

                            stdout:
                                '3 passed in 0.03s'
                        })
                    );

                expect(
                    result.status
                ).toBe(
                    'PASS'
                );

                expect(
                    result.evidence.report.oracleStatus
                ).toBe(
                    'PASS'
                );

                expect(
                    result.evidence.report.suitePassed
                ).toBe(
                    true
                );

                expect(
                    result.evidence.report.oracleFailed
                ).toBe(
                    false
                );

                expect(
                    result.evidence.report.timedOut
                ).toBe(
                    false
                );

                expect(
                    result.evidence.report.exitCode
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.totalTests
                ).toBe(
                    3
                );

                expect(
                    result.evidence.report.passedTests
                ).toBe(
                    3
                );

                expect(
                    result.evidence.report.failedTests
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.skippedTests
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.xfailedTests
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.xpassedTests
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.errorTests
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.passRate
                ).toBe(
                    1
                );

                expect(
                    result.evidence.report
                        .failureDetails
                ).toEqual(
                    []
                );

                expect(
                    () =>
                        assertFunctionalTestResultInvariants(
                            result
                        )
                ).not.toThrow();
            }
        );

        it(
            'classifica FAIL una suite con skipped anche con exit code 0',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                0,

                            stdout:
                                '1 passed, 1 skipped in 0.02s'
                        })
                    );

                expectStrictFailure(
                    result,
                    {
                        totalTests:
                            2,

                        passedTests:
                            1,

                        skippedTests:
                            1,

                        xfailedTests:
                            0,

                        xpassedTests:
                            0
                    }
                );

                expect(
                    result.evidence.report.passRate
                ).toBe(
                    0.5
                );

                expect(
                    result.summary
                ).toContain(
                    '1 skipped'
                );
            }
        );

        it(
            'classifica FAIL una suite con xfailed anche con exit code 0',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                0,

                            stdout:
                                '1 passed, 1 xfailed in 0.02s'
                        })
                    );

                expectStrictFailure(
                    result,
                    {
                        totalTests:
                            2,

                        passedTests:
                            1,

                        skippedTests:
                            0,

                        xfailedTests:
                            1,

                        xpassedTests:
                            0
                    }
                );

                expect(
                    result.evidence.report.passRate
                ).toBe(
                    0.5
                );

                expect(
                    result.summary
                ).toContain(
                    '1 xfailed'
                );
            }
        );

        it(
            'classifica FAIL una suite con xpassed anche con exit code 0',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                0,

                            stdout:
                                '1 passed, 1 xpassed in 0.02s'
                        })
                    );

                expectStrictFailure(
                    result,
                    {
                        totalTests:
                            2,

                        passedTests:
                            1,

                        skippedTests:
                            0,

                        xfailedTests:
                            0,

                        xpassedTests:
                            1
                    }
                );

                expect(
                    result.evidence.report.passRate
                ).toBe(
                    0.5
                );

                expect(
                    result.summary
                ).toContain(
                    '1 xpassed'
                );
            }
        );

        it(
            'classifica FAIL una suite con più violazioni strict contemporaneamente',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                0,

                            stdout:
                                [
                                    '2 passed,',
                                    '1 skipped,',
                                    '1 xfailed,',
                                    '1 xpassed',
                                    'in 0.05s'
                                ].join(
                                    ' '
                                )
                        })
                    );

                expectStrictFailure(
                    result,
                    {
                        totalTests:
                            5,

                        passedTests:
                            2,

                        skippedTests:
                            1,

                        xfailedTests:
                            1,

                        xpassedTests:
                            1
                    }
                );

                expect(
                    result.evidence.report.passRate
                ).toBe(
                    0.4
                );

                expect(
                    result.evidence.report
                        .failureDetails[0]
                        ?.assertionMessage
                ).toContain(
                    '1 skipped'
                );

                expect(
                    result.evidence.report
                        .failureDetails[0]
                        ?.assertionMessage
                ).toContain(
                    '1 xfailed'
                );

                expect(
                    result.evidence.report
                        .failureDetails[0]
                        ?.assertionMessage
                ).toContain(
                    '1 xpassed'
                );
            }
        );

        it(
            'non classifica una violazione strict come EXECUTION_ERROR',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                0,

                            stdout:
                                '2 passed, 1 skipped in 0.03s'
                        })
                    );

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.status
                ).not.toBe(
                    'EXECUTION_ERROR'
                );

                expect(
                    result.evidence.report.oracleFailed
                ).toBe(
                    false
                );

                expect(
                    result.evidence.report
                        .oracleFailureReason
                ).toBeUndefined();

                expect(
                    result.evidence.report
                        .failureDetails[0]
                        ?.testName
                ).toBe(
                    'TestSuiteNonConformity'
                );
            }
        );

        it(
            'mantiene EXECUTION_ERROR separato dalla strict policy',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                2,

                            stdout:
                                '1 passed in 0.01s',

                            stderr:
                                'pytest execution error'
                        })
                    );

                expect(
                    result.status
                ).toBe(
                    'EXECUTION_ERROR'
                );

                expect(
                    result.evidence.report.oracleStatus
                ).toBe(
                    'EXECUTION_ERROR'
                );

                expect(
                    result.evidence.report.suitePassed
                ).toBe(
                    false
                );

                expect(
                    result.evidence.report.oracleFailed
                ).toBe(
                    true
                );

                expect(
                    result.evidence.report
                        .oracleFailureReason
                ).toContain(
                    'classificato dalla policy come errore di esecuzione'
                );

                expect(
                    result.evidence.report
                        .failureDetails[0]
                        ?.testName
                ).toBe(
                    'OracleExecutionFailure'
                );

                expect(
                    () =>
                        assertFunctionalTestResultInvariants(
                            result
                        )
                ).not.toThrow();
            }
        );

        it(
            'classifica FAIL un vero fallimento funzionale con exit code 1',
            async () => {
                const result =
                    await evaluateWithResult(
                        createProcessResult({
                            exitCode:
                                1,

                            stdout:
                                [
                                    'FAILED tests/test_target.py::test_target',
                                    '1 failed in 0.02s'
                                ].join(
                                    '\n'
                                )
                        })
                    );

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.evidence.report.oracleFailed
                ).toBe(
                    false
                );

                expect(
                    result.evidence.report.failedTests
                ).toBe(
                    1
                );

                expect(
                    result.evidence.report.errorTests
                ).toBe(
                    0
                );

                expect(
                    result.evidence.report.exitCode
                ).toBe(
                    1
                );

                expect(
                    () =>
                        assertFunctionalTestResultInvariants(
                            result
                        )
                ).not.toThrow();
            }
        );
    }
);
