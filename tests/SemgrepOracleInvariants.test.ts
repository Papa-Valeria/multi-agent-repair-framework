import {
    describe,
    expect,
    it
} from '@jest/globals';

import type {
    OracleResult,
    SastFinding,
    TestExecutionReport,
    VerificationVerdict
} from '../src/types/domain.js';

import {
    assertSemgrepResultInvariants,
    assertVerificationVerdictInvariants,
    VerificationInvariantError
} from '../src/verification/VerificationInvariants.js';

const sampleFinding:
    SastFinding = {
    ruleId:
        'security.test-rule',

    path:
        'src/target.py',

    startLine:
        10,

    endLine:
        10,

    severity:
        'ERROR',

    message:
        'Synthetic Semgrep finding.',

    cweHierarchy:
        []
};

const createSemgrepResult = (
    overrides:
        Partial<OracleResult<'SEMGREP'>> = {},
    evidenceOverrides:
        Partial<
            OracleResult<'SEMGREP'>['evidence']
        > = {}
): OracleResult<'SEMGREP'> => {
    const base:
        OracleResult<'SEMGREP'> = {
        oracle:
            'SEMGREP',

        status:
            'PASS',

        required:
            true,

        durationMs:
            10,

        summary:
            'Semgrep result.',

        evidence: {
            findings:
                [],

            scannedFiles: [
                'src/target.py'
            ]
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
    semgrepResult:
        OracleResult<'SEMGREP'>,
    overrides:
        Partial<VerificationVerdict> = {}
): VerificationVerdict => ({
    verified:
        false,

    oracleResults: [
        semgrepResult
    ],

    sastFindings:
        semgrepResult.evidence.findings,

    semgrepDurationMs:
        semgrepResult.durationMs,

    testReport:
        functionalReportNotAvailable,

    ...overrides
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
    'BE-P1-06 - Semgrep Oracle invariants',
    () => {
        describe(
            'PASS',
            () => {
                it(
                    'accetta PASS con findings vuoto, file analizzati e nessun executionError',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ]
                                }
                            );

                        expect(
                            () =>
                                assertSemgrepResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta PASS con findings non vuoto',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ]
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'PASS richiede findings vuoto'
                        );
                    }
                );

                it(
                    'rifiuta PASS senza file analizzati',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles:
                                        []
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'PASS richiede almeno un file analizzato'
                        );
                    }
                );

                it(
                    'rifiuta PASS con executionError',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    executionError:
                                        'Injected Semgrep error'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
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
                    'accetta FAIL con almeno un finding e almeno un file analizzato',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ],

                                    scannedFiles: [
                                        'src/target.py'
                                    ]
                                }
                            );

                        expect(
                            () =>
                                assertSemgrepResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta FAIL con findings vuoto',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ]
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'FAIL richiede almeno un finding'
                        );
                    }
                );

                it(
                    'rifiuta FAIL senza file analizzati',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ],

                                    scannedFiles:
                                        []
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'FAIL richiede almeno un file analizzato'
                        );
                    }
                );

                it(
                    'rifiuta FAIL con executionError',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ],

                                    scannedFiles: [
                                        'src/target.py'
                                    ],

                                    executionError:
                                        'Semgrep execution failed'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
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
                    'accetta NOT_AVAILABLE senza findings e senza file da analizzare',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles:
                                        []
                                }
                            );

                        expect(
                            () =>
                                assertSemgrepResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta NOT_AVAILABLE con findings',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ],

                                    scannedFiles:
                                        []
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'NOT_AVAILABLE richiede findings vuoto'
                        );
                    }
                );

                it(
                    'rifiuta NOT_AVAILABLE con file analizzati',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ]
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'NOT_AVAILABLE richiede scannedFiles vuoto'
                        );
                    }
                );

                it(
                    'rifiuta NOT_AVAILABLE con executionError',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'NOT_AVAILABLE'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles:
                                        [],

                                    executionError:
                                        'Semgrep unavailable due to error'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
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
                    'accetta EXECUTION_ERROR con executionError non vuoto',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ],

                                    executionError:
                                        'Semgrep process terminated unexpectedly'
                                }
                            );

                        expect(
                            () =>
                                assertSemgrepResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'accetta EXECUTION_ERROR anche senza file analizzati se executionError è presente',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles:
                                        [],

                                    executionError:
                                        'Impossibile risolvere i file da analizzare'
                                }
                            );

                        expect(
                            () =>
                                assertSemgrepResultInvariants(
                                    result
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta EXECUTION_ERROR senza executionError',
                    () => {
                        /*
                         * Con exactOptionalPropertyTypes=true una
                         * proprietà opzionale assente deve essere
                         * realmente omessa, non valorizzata con
                         * undefined.
                         */
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ]
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'EXECUTION_ERROR richiede executionError non vuoto'
                        );
                    }
                );

                it(
                    'rifiuta EXECUTION_ERROR con executionError composto soltanto da whitespace',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ],

                                    executionError:
                                        '   '
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'EXECUTION_ERROR richiede executionError non vuoto'
                        );
                    }
                );

                it(
                    'rifiuta EXECUTION_ERROR con findings',
                    () => {
                        const result =
                            createSemgrepResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ],

                                    scannedFiles: [
                                        'src/target.py'
                                    ],

                                    executionError:
                                        'Semgrep failed'
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
                                        result
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'EXECUTION_ERROR richiede findings vuoto'
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
                            createSemgrepResult({
                                durationMs:
                                    -1
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
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
                            createSemgrepResult({
                                durationMs:
                                    Number.NaN
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
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
                            createSemgrepResult({
                                durationMs:
                                    Number.POSITIVE_INFINITY
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertSemgrepResultInvariants(
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
                    'accetta un verdict con risultato Semgrep PASS coerente',
                    () => {
                        const semgrep =
                            createSemgrepResult();

                        const verdict =
                            createVerdict(
                                semgrep
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
                    'accetta un verdict con risultato Semgrep FAIL coerente',
                    () => {
                        const semgrep =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ]
                                }
                            );

                        const verdict =
                            createVerdict(
                                semgrep
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
                    'rifiuta un verdict contenente PASS Semgrep con findings',
                    () => {
                        const semgrep =
                            createSemgrepResult(
                                {
                                    status:
                                        'PASS'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ]
                                }
                            );

                        const verdict =
                            createVerdict(
                                semgrep
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
                            'SEMGREP: PASS richiede findings vuoto'
                        );
                    }
                );

                it(
                    'rifiuta un verdict contenente FAIL Semgrep senza findings',
                    () => {
                        const semgrep =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings:
                                        []
                                }
                            );

                        const verdict =
                            createVerdict(
                                semgrep
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
                            'SEMGREP: FAIL richiede almeno un finding'
                        );
                    }
                );

                it(
                    'rifiuta un verdict contenente EXECUTION_ERROR senza reason',
                    () => {
                        /*
                         * Non usare executionError: undefined.
                         * L'assenza del campo rappresenta
                         * correttamente il caso sotto test.
                         */
                        const semgrep =
                            createSemgrepResult(
                                {
                                    status:
                                        'EXECUTION_ERROR'
                                },
                                {
                                    findings:
                                        [],

                                    scannedFiles: [
                                        'src/target.py'
                                    ]
                                }
                            );

                        const verdict =
                            createVerdict(
                                semgrep
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
                            'SEMGREP: EXECUTION_ERROR richiede executionError non vuoto'
                        );
                    }
                );

                it(
                    'rifiuta divergenza tra verdict.sastFindings ed evidence.findings',
                    () => {
                        const semgrep =
                            createSemgrepResult(
                                {
                                    status:
                                        'FAIL'
                                },
                                {
                                    findings: [
                                        sampleFinding
                                    ]
                                }
                            );

                        const verdict =
                            createVerdict(
                                semgrep,
                                {
                                    sastFindings:
                                        []
                                }
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
                            'verdict.sastFindings non coincide ' +
                            'strutturalmente con i finding del ' +
                            'SEMGREP presente negli oracleResults'
                        );
                    }
                );

                it(
                    'rifiuta divergenza tra semgrepDurationMs e durata del risultato',
                    () => {
                        const semgrep =
                            createSemgrepResult({
                                durationMs:
                                    15
                            });

                        const verdict =
                            createVerdict(
                                semgrep,
                                {
                                    semgrepDurationMs:
                                        99
                                }
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
                            'verdict.semgrepDurationMs=99 non ' +
                            'coincide con la durata del SEMGREP=15'
                        );
                    }
                );
            }
        );
    }
);
