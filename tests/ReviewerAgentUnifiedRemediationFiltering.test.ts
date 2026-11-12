import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    ReviewerAgent,
    type ReviewerReviewParams
} from '../src/agents/ReviewerAgent.js';

import type {
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

import type {
    OracleResult,
    SastFinding,
    TestExecutionReport
} from '../src/types/domain.js';

const createClient = (
    behavior:
        string | Error
): OpenAICompatibleClient => ({
    completeChat:
        jest.fn(
            async (): Promise<string> => {
                if (
                    behavior instanceof Error
                ) {
                    throw behavior;
                }

                return behavior;
            }
        )
}) as unknown as OpenAICompatibleClient;

const buildSyntaxPass:
    OracleResult<'BUILD_SYNTAX'> = {
    oracle:
        'BUILD_SYNTAX',

    status:
        'PASS',

    required:
        true,

    durationMs:
        1,

    summary:
        'Build superata.',

    evidence: {
        command:
            'python',

        args:
            [],

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

const testReportPass:
    TestExecutionReport = {
    oracleStatus:
        'PASS',

    command:
        'pytest',

    args:
        [],

    cwd:
        '.',

    timeoutMs:
        5_000,

    envAllowList:
        [],

    oracleFilesExecuted: [
        'tests/test_target.py'
    ],

    implicitDiscoveryUsed:
        false,

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

    exitCode:
        0,

    suitePassed:
        true,

    timedOut:
        false,

    oracleFailed:
        false,

    totalTests:
        1,

    passedTests:
        1,

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
        1,

    durationMs:
        1,

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
        1
};

const createFailedTestReport =
    (): TestExecutionReport => ({
        ...testReportPass,

        oracleStatus:
            'FAIL',

        exitCode:
            1,

        suitePassed:
            false,

        totalTests:
            1,

        passedTests:
            0,

        failedTests:
            1,

        passRate:
            0,

        failureDetails: [
            {
                testName:
                    'test_target',

                assertionMessage:
                    'failure',

                stackTrace:
                    ''
            }
        ]
    });

const createFinding = (
    path: string,
    ruleId: string
): SastFinding => ({
    ruleId,

    path,

    startLine:
        10,

    endLine:
        10,

    severity:
        'ERROR',

    message:
        'Synthetic SAST finding.'
});

const createParams = (
    overrides:
        Partial<ReviewerReviewParams> = {}
): ReviewerReviewParams => ({
    buildSyntax:
        buildSyntaxPass,

    sastFindings:
        [],

    testReport:
        testReportPass,

    flappingDetected:
        false,

    targetFiles: [
        './src\\target.py'
    ],

    testFiles: [
        './tests\\test_target.py'
    ],

    category:
        'REPAIR',

    ...overrides
});

const review = async (
    behavior:
        string | Error,
    params:
        ReviewerReviewParams
) => {
    const reviewer =
        new ReviewerAgent(
            createClient(
                behavior
            )
        );

    return reviewer.review(
        params
    );
};

describe(
    'BE-P1-03 - ReviewerAgent unified remediation filtering',
    () => {
        describe(
            'percorso LLM',
            () => {
                it(
                    'normalizza e mantiene un target REPAIR autorizzato',
                    async () => {
                        const result =
                            await review(
                                JSON.stringify({
                                    rootCauseSummary:
                                        'Diagnosi valida.',

                                    targetRemediations: [
                                        {
                                            file:
                                                './src\\target.py',

                                            lineRange: {
                                                start:
                                                    1,

                                                end:
                                                    1
                                            },

                                            rootCause:
                                                'Comportamento errato.',

                                            mandatoryCorrection:
                                                'Correggere il codice sorgente.'
                                        }
                                    ]
                                }),
                                createParams()
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'LLM'
                        );

                        expect(
                            result.fallbackReason
                        ).toBeUndefined();

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.file
                                )
                        ).toEqual([
                            'src/target.py'
                        ]);
                    }
                );

                it(
                    'filtra un file test dichiarato in CREATE e attiva il fallback sul source target',
                    async () => {
                        const result =
                            await review(
                                JSON.stringify({
                                    rootCauseSummary:
                                        'Remediation vietata.',

                                    targetRemediations: [
                                        {
                                            file:
                                                './tests\\test_target.py',

                                            lineRange: {
                                                start:
                                                    1,

                                                end:
                                                    1
                                            },

                                            rootCause:
                                                'Comportamento del test.',

                                            mandatoryCorrection:
                                                'Correggere il contenuto del file.'
                                        }
                                    ]
                                }),
                                createParams({
                                    category:
                                        'CREATE',

                                    testReport:
                                        createFailedTestReport()
                                })
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'DETERMINISTIC_FALLBACK'
                        );

                        expect(
                            result.fallbackReason
                        ).toContain(
                            'Nessuna targetRemediation valida'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .length
                        ).toBeGreaterThan(
                            0
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .every(
                                    (remediation) =>
                                        remediation.file !==
                                        'tests/test_target.py'
                                )
                        ).toBe(
                            true
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .every(
                                    (remediation) =>
                                        remediation.file ===
                                        'src/target.py'
                                )
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'filtra un file fuori target in REPAIR mantenendo una remediation autorizzata',
                    async () => {
                        const result =
                            await review(
                                JSON.stringify({
                                    rootCauseSummary:
                                        'Diagnosi mista.',

                                    targetRemediations: [
                                        {
                                            file:
                                                './src\\other.py',

                                            lineRange: {
                                                start:
                                                    5,

                                                end:
                                                    5
                                            },

                                            rootCause:
                                                'Finding fuori target.',

                                            mandatoryCorrection:
                                                'Correggere il sorgente.'
                                        },
                                        {
                                            file:
                                                './src\\target.py',

                                            lineRange: {
                                                start:
                                                    10,

                                                end:
                                                    10
                                            },

                                            rootCause:
                                                'Finding sul target.',

                                            mandatoryCorrection:
                                                'Correggere il sorgente target.'
                                        }
                                    ]
                                }),
                                createParams()
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'LLM'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.file
                                )
                        ).toEqual([
                            'src/target.py'
                        ]);
                    }
                );

                it(
                    'filtra una mutation esplicita del test mantenendo una remediation sorgente',
                    async () => {
                        const result =
                            await review(
                                JSON.stringify({
                                    rootCauseSummary:
                                        'Diagnosi mista.',

                                    targetRemediations: [
                                        {
                                            file:
                                                './src\\target.py',

                                            lineRange: {
                                                start:
                                                    1,

                                                end:
                                                    1
                                            },

                                            rootCause:
                                                'The test assertion fails.',

                                            mandatoryCorrection:
                                                'Modify the test assertion to expect False.'
                                        },
                                        {
                                            file:
                                                './src\\target.py',

                                            lineRange: {
                                                start:
                                                    2,

                                                end:
                                                    2
                                            },

                                            rootCause:
                                                'Il sorgente restituisce il valore errato.',

                                            mandatoryCorrection:
                                                'Correggere il valore restituito dal codice sorgente.'
                                        }
                                    ]
                                }),
                                createParams()
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'LLM'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            1
                        );

                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.lineRange
                        ).toEqual({
                            start:
                                2,

                            end:
                                2
                        });
                    }
                );
            }
        );

        describe(
            'percorso fallback',
            () => {
                it(
                    'filtra il finding SAST fuori target in REPAIR e mantiene quello sul target',
                    async () => {
                        const result =
                            await review(
                                new Error(
                                    'Injected Reviewer failure'
                                ),
                                createParams({
                                    sastFindings: [
                                        createFinding(
                                            './src\\other.py',
                                            'outside.rule'
                                        ),
                                        createFinding(
                                            './src\\target.py',
                                            'target.rule'
                                        )
                                    ]
                                })
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'DETERMINISTIC_FALLBACK'
                        );

                        expect(
                            result.fallbackReason
                        ).toBe(
                            'Injected Reviewer failure'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.file
                                )
                        ).toEqual([
                            'src/target.py'
                        ]);

                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.relatedRuleId
                        ).toBe(
                            'target.rule'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .some(
                                    (remediation) =>
                                        remediation.file ===
                                        'src/other.py'
                                )
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'non restituisce un finding SAST indirizzato a un test dichiarato in CREATE',
                    async () => {
                        const resultPromise =
                            review(
                                new Error(
                                    'Injected Reviewer failure'
                                ),
                                createParams({
                                    category:
                                        'CREATE',

                                    sastFindings: [
                                        createFinding(
                                            './tests\\test_target.py',
                                            'test.rule'
                                        )
                                    ]
                                })
                            );

                        await expect(
                            resultPromise
                        ).rejects.toThrow(
                            'Nessuna remediation sorgente deterministica autorizzata'
                        );
                    }
                );

                it(
                    'normalizza il path del finding fallback autorizzato',
                    async () => {
                        const result =
                            await review(
                                new Error(
                                    'Injected Reviewer failure'
                                ),
                                createParams({
                                    sastFindings: [
                                        createFinding(
                                            './src\\target.py',
                                            'target.rule'
                                        )
                                    ]
                                })
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'DETERMINISTIC_FALLBACK'
                        );

                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.file
                        ).toBe(
                            'src/target.py'
                        );
                    }
                );

                it(
                    'mantiene la remediation funzionale fallback sul source target',
                    async () => {
                        const result =
                            await review(
                                new Error(
                                    'Injected Reviewer failure'
                                ),
                                createParams({
                                    testReport:
                                        createFailedTestReport()
                                })
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'DETERMINISTIC_FALLBACK'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.file
                                )
                        ).toEqual([
                            'src/target.py'
                        ]);

                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.mandatoryCorrection
                        ).toContain(
                            'codice sorgente target'
                        );
                    }
                );
            }
        );

        it(
            'applica la stessa decisione di ammissibilità a LLM e fallback',
            async () => {
                const llmResult =
                    await review(
                        JSON.stringify({
                            rootCauseSummary:
                                'Diagnosi LLM.',

                            targetRemediations: [
                                {
                                    file:
                                        './src\\other.py',

                                    lineRange: {
                                        start:
                                            10,

                                        end:
                                            10
                                    },

                                    rootCause:
                                        'Fuori target.',

                                    mandatoryCorrection:
                                        'Correggere il sorgente.'
                                },
                                {
                                    file:
                                        './src\\target.py',

                                    lineRange: {
                                        start:
                                            10,

                                        end:
                                            10
                                    },

                                    rootCause:
                                        'Target valido.',

                                    mandatoryCorrection:
                                        'Correggere il sorgente.'
                                }
                            ]
                        }),
                        createParams()
                    );

                const fallbackResult =
                    await review(
                        new Error(
                            'Injected Reviewer failure'
                        ),
                        createParams({
                            sastFindings: [
                                createFinding(
                                    './src\\other.py',
                                    'outside.rule'
                                ),
                                createFinding(
                                    './src\\target.py',
                                    'target.rule'
                                )
                            ]
                        })
                    );

                expect(
                    llmResult.feedback
                        .targetRemediations
                        .map(
                            (remediation) =>
                                remediation.file
                        )
                ).toEqual([
                    'src/target.py'
                ]);

                expect(
                    fallbackResult.feedback
                        .targetRemediations
                        .map(
                            (remediation) =>
                                remediation.file
                        )
                ).toEqual([
                    'src/target.py'
                ]);
            }
        );
    }
);
