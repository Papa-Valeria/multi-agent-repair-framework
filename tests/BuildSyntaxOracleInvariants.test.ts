import {
    describe,
    expect,
    it
} from '@jest/globals';

import type {
    OracleResult,
    TestExecutionReport,
    VerificationVerdict
} from '../src/types/domain.js';

import {
    assertBuildSyntaxResultInvariants,
    assertVerificationVerdictInvariants,
    VerificationInvariantError
} from '../src/verification/VerificationInvariants.js';

const createBuildResult = (
    overrides:
        Partial<OracleResult<'BUILD_SYNTAX'>> = {},
    evidenceOverrides:
        Partial<
            OracleResult<'BUILD_SYNTAX'>['evidence']
        > = {}
): OracleResult<'BUILD_SYNTAX'> => {
    const base:
        OracleResult<'BUILD_SYNTAX'> = {
        oracle:
            'BUILD_SYNTAX',

        status:
            'PASS',

        required:
            true,

        durationMs:
            10,

        summary:
            'Build/Syntax result.',

        evidence: {
            command:
                'python',

            args: [
                '-m',
                'py_compile',
                'src/target.py'
            ],

            cwd:
                '.',

            timeoutMs:
                5_000,

            envAllowList:
                [],

            exitCode:
                0,

            timedOut:
                false,

            stdout:
                '',

            stderr:
                ''
        }
    };

    return {
        ...base,
        ...overrides,

        evidence: {
            ...base.evidence,
            ...evidenceOverrides
        }
    };
};

const functionalReportNotAvailable:
    TestExecutionReport = {
    oracleStatus:
        'NOT_AVAILABLE',

    command:
        null,

    args:
        [],

    cwd:
        null,

    timeoutMs:
        null,

    envAllowList:
        [],

    oracleFilesExecuted:
        [],

    implicitDiscoveryUsed:
        false,

    expectedExitPolicy:
        null,

    exitCode:
        null,

    suitePassed:
        false,

    timedOut:
        false,

    oracleFailed:
        false,

    totalTests:
        0,

    passedTests:
        0,

    failedTests:
        0,

    skippedTests:
        0,

    xfailedTests:
        0,

    xpassedTests:
        0,

    errorTests:
        0,

    passRate:
        0,

    durationMs:
        0,

    failureDetails:
        [],

    stdout:
        '',

    stderr:
        '',

    rawStdout:
        '',

    rawStderr:
        '',

    executionDurationMs:
        0
};

const createVerdict = (
    buildResult:
        OracleResult<'BUILD_SYNTAX'>
): VerificationVerdict => ({
    verified:
        false,

    oracleResults: [
        buildResult
    ],

    sastFindings:
        [],

    testReport:
        functionalReportNotAvailable
});

const captureInvariant = (
    callback: () => void
): VerificationInvariantError => {
    try {
        callback();
    } catch (error: unknown) {
        expect(
            error
        ).toBeInstanceOf(
            VerificationInvariantError
        );

        return error as
            VerificationInvariantError;
    }

    throw new Error(
        'Il test attendeva una VerificationInvariantError.'
    );
};

describe(
    'BE-P1-05 - BuildSyntax Oracle invariants',
    () => {
        describe(
            'PASS',
            () => {
                it(
                    'accetta PASS con exitCode zero, nessun timeout e nessun executionError',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    exitCode:
                                        0,

                                    timedOut:
                                        false
                                }
                            );

                        expect(
                            () =>
                                assertBuildSyntaxResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta PASS con exitCode non-zero',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    exitCode:
                                        1
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'PASS richiede exitCode=0, ricevuto 1'
                        );
                    }
                );

                it(
                    'rifiuta PASS con exitCode null',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    exitCode:
                                        null
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'PASS richiede exitCode=0, ricevuto null'
                        );
                    }
                );

                it(
                    'rifiuta PASS con timedOut true',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    exitCode:
                                        0,

                                    timedOut:
                                        true
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'PASS richiede timedOut=false'
                        );
                    }
                );

                it(
                    'rifiuta PASS con executionError non vuoto',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    exitCode:
                                        0,

                                    executionError:
                                        'Injected execution error'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'PASS non consente executionError'
                        );
                    }
                );
            }
        );

        describe(
            'FAIL',
            () => {
                it(
                    'accetta FAIL con exitCode non-zero, nessun timeout e nessun executionError',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    exitCode:
                                        1,

                                    timedOut:
                                        false,

                                    stderr:
                                        'SyntaxError'
                                }
                            );

                        expect(
                            () =>
                                assertBuildSyntaxResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta FAIL con exitCode zero',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    exitCode:
                                        0
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'FAIL richiede exitCode diverso da 0'
                        );
                    }
                );

                it(
                    'rifiuta FAIL con exitCode null',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    exitCode:
                                        null
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'FAIL richiede un exitCode valido'
                        );
                    }
                );

                it(
                    'rifiuta FAIL con timedOut true',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    exitCode:
                                        1,

                                    timedOut:
                                        true
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'FAIL richiede timedOut=false'
                        );
                    }
                );

                it(
                    'rifiuta FAIL con executionError non vuoto',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    exitCode:
                                        1,

                                    executionError:
                                        'Process execution failed'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'FAIL non consente executionError'
                        );
                    }
                );
            }
        );

        describe(
            'NOT_AVAILABLE',
            () => {
                it(
                    'accetta NOT_AVAILABLE con exitCode null e nessuna evidenza di esecuzione fallita',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    command:
                                        '',

                                    args:
                                        [],

                                    cwd:
                                        '',

                                    timeoutMs:
                                        0,

                                    envAllowList:
                                        [],

                                    exitCode:
                                        null,

                                    timedOut:
                                        false,

                                    stdout:
                                        '',

                                    stderr:
                                        ''
                                }
                            );

                        expect(
                            () =>
                                assertBuildSyntaxResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta NOT_AVAILABLE con exitCode numerico',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    exitCode:
                                        0
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'NOT_AVAILABLE richiede exitCode=null'
                        );
                    }
                );

                it(
                    'rifiuta NOT_AVAILABLE con timedOut true',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    exitCode:
                                        null,

                                    timedOut:
                                        true
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'NOT_AVAILABLE richiede timedOut=false'
                        );
                    }
                );

                it(
                    'rifiuta NOT_AVAILABLE con executionError non vuoto',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    exitCode:
                                        null,

                                    executionError:
                                        'Unexpected execution error'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'NOT_AVAILABLE non consente executionError'
                        );
                    }
                );
            }
        );

        describe(
            'EXECUTION_ERROR',
            () => {
                it(
                    'accetta EXECUTION_ERROR con exitCode null',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    exitCode:
                                        null,

                                    timedOut:
                                        false
                                }
                            );

                        expect(
                            () =>
                                assertBuildSyntaxResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'accetta EXECUTION_ERROR con timedOut true',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    exitCode:
                                        124,

                                    timedOut:
                                        true
                                }
                            );

                        expect(
                            () =>
                                assertBuildSyntaxResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'accetta EXECUTION_ERROR con executionError non vuoto',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    exitCode:
                                        1,

                                    timedOut:
                                        false,

                                    executionError:
                                        'Unable to spawn process'
                                }
                            );

                        expect(
                            () =>
                                assertBuildSyntaxResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta EXECUTION_ERROR senza evidenza di errore infrastrutturale',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    exitCode:
                                        1,

                                    timedOut:
                                        false
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'EXECUTION_ERROR richiede timedOut=true, ' +
                            'executionError non vuoto oppure exitCode=null'
                        );
                    }
                );

                it(
                    'ignora executionError composto soltanto da whitespace',
                    () => {
                        const result =
                            createBuildResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    exitCode:
                                        1,

                                    timedOut:
                                        false,

                                    executionError:
                                        '   '
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'EXECUTION_ERROR richiede timedOut=true, ' +
                            'executionError non vuoto oppure exitCode=null'
                        );
                    }
                );
            }
        );

        describe(
            'invarianti comuni',
            () => {
                it(
                    'rifiuta durationMs negativo',
                    () => {
                        const result =
                            createBuildResult({
                                durationMs:
                                    -1
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'durationMs deve essere finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta durationMs NaN',
                    () => {
                        const result =
                            createBuildResult({
                                durationMs:
                                    Number.NaN
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'durationMs deve essere finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta durationMs infinito',
                    () => {
                        const result =
                            createBuildResult({
                                durationMs:
                                    Number.POSITIVE_INFINITY
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertBuildSyntaxResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'durationMs deve essere finito e non negativo'
                        );
                    }
                );
            }
        );

        describe(
            'integrazione nel VerificationVerdict',
            () => {
                it(
                    'accetta un verdict contenente un risultato Build coerente',
                    () => {
                        const verdict =
                            createVerdict(
                                createBuildResult(
                                    {
                                        status:
                                            'PASS'
                                    },
                                    {
                                        exitCode:
                                            0,

                                        timedOut:
                                            false
                                    }
                                )
                            );

                        expect(
                            () =>
                                assertVerificationVerdictInvariants(
                                    verdict
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta un verdict contenente PASS Build con exitCode non-zero',
                    () => {
                        const verdict =
                            createVerdict(
                                createBuildResult(
                                    {
                                        status:
                                            'PASS'
                                    },
                                    {
                                        exitCode:
                                            1
                                    }
                                )
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertVerificationVerdictInvariants(
                                        verdict
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'BUILD_SYNTAX: PASS richiede exitCode=0, ricevuto 1'
                        );
                    }
                );

                it(
                    'rifiuta un verdict contenente FAIL Build con exitCode zero',
                    () => {
                        const verdict =
                            createVerdict(
                                createBuildResult(
                                    {
                                        status:
                                            'FAIL'
                                    },
                                    {
                                        exitCode:
                                            0
                                    }
                                )
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertVerificationVerdictInvariants(
                                        verdict
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'BUILD_SYNTAX: FAIL richiede exitCode diverso da 0'
                        );
                    }
                );

                it(
                    'rifiuta un verdict contenente EXECUTION_ERROR senza evidenza coerente',
                    () => {
                        const verdict =
                            createVerdict(
                                createBuildResult(
                                    {
                                        status:
                                            'EXECUTION_ERROR'
                                    },
                                    {
                                        exitCode:
                                            1,

                                        timedOut:
                                            false
                                    }
                                )
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertVerificationVerdictInvariants(
                                        verdict
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'BUILD_SYNTAX: EXECUTION_ERROR richiede timedOut=true, ' +
                            'executionError non vuoto oppure exitCode=null'
                        );
                    }
                );
            }
        );
    }
);
