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
    TestExecutionReport
} from '../src/types/domain.js';

const createClient = (
    rawResponse: string
): OpenAICompatibleClient => ({
    completeChat:
        jest.fn(
            async (): Promise<string> =>
                rawResponse
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
        5,

    summary:
        'Build/Syntax superato.',

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

const failedTestReport:
    TestExecutionReport = {
    oracleStatus:
        'FAIL',

    command:
        'pytest',

    args: [
        '-q',
        'tests/test_target.py'
    ],

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
        1,

    suitePassed:
        false,

    timedOut:
        false,

    oracleFailed:
        false,

    totalTests:
        1,

    passedTests:
        0,

    failedTests:
        1,

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
        20,

    failureDetails: [
        {
            testName:
                'test_target',

            assertionMessage:
                'assert False is True',

            stackTrace:
                'tests/test_target.py:2',

            expected:
                'True',

            actual:
                'False'
        }
    ],

    stdout:
        '',

    stderr:
        '',

    rawStdout:
        '',

    rawStderr:
        '',

    executionDurationMs:
        20
};

const createParams = (
    overrides:
        Partial<ReviewerReviewParams> = {}
): ReviewerReviewParams => ({
    buildSyntax:
        buildSyntaxPass,

    sastFindings:
        [],

    testReport:
        failedTestReport,

    flappingDetected:
        false,

    targetFiles: [
        'src/target.py'
    ],

    testFiles: [
        'tests/test_target.py'
    ],

    category:
        'REPAIR',

    ...overrides
});

const validRemediation = {
    file:
        './src\\target.py',

    lineRange: {
        start:
            1,

        end:
            2
    },

    rootCause:
        'La funzione restituisce False invece di True.',

    mandatoryCorrection:
        'Correggere il codice sorgente affinché la funzione restituisca True.',

    relatedRuleId:
        ' test.rule '
};

const validPayload = {
    rootCauseSummary:
        'La funzione restituisce il valore errato.',

    violationsPrunedCount:
        999,

    targetRemediations: [
        validRemediation
    ],

    securityPriorityStrict:
        false,

    flappingDetected:
        true
};

const reviewResponse = async (
    rawResponse: string,
    params:
        ReviewerReviewParams =
        createParams()
) => {
    const reviewer =
        new ReviewerAgent(
            createClient(
                rawResponse
            )
        );

    return reviewer.review(
        params
    );
};

const expectFallback = async (
    rawResponse: string,
    expectedReason:
        string | RegExp
): Promise<void> => {
    const result =
        await reviewResponse(
            rawResponse
        );

    expect(
        result.reviewerMode
    ).toBe(
        'DETERMINISTIC_FALLBACK'
    );

    expect(
        result.fallbackReason
    ).toBeDefined();

    if (
        typeof expectedReason === 'string'
    ) {
        expect(
            result.fallbackReason
        ).toContain(
            expectedReason
        );
    } else {
        expect(
            result.fallbackReason
        ).toMatch(
            expectedReason
        );
    }

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
                    remediation.file ===
                    'src/target.py'
            )
    ).toBe(
        true
    );
};

const payloadWithRemediation = (
    remediation: unknown
): string =>
    JSON.stringify({
        rootCauseSummary:
            'Diagnosi valida.',

        targetRemediations: [
            remediation
        ]
    });

describe(
    'BE-P1-02 - ReviewerAgent runtime response schema',
    () => {
        describe(
            'payload validi',
            () => {
                it(
                    'accetta un oggetto JSON canonico',
                    async () => {
                        const result =
                            await reviewResponse(
                                JSON.stringify(
                                    validPayload
                                )
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
                        ).toEqual([
                            {
                                file:
                                    'src/target.py',

                                lineRange: {
                                    start:
                                        1,

                                    end:
                                        2
                                },

                                rootCause:
                                    'La funzione restituisce False invece di True.',

                                mandatoryCorrection:
                                    'Correggere il codice sorgente affinché la funzione restituisca True.',

                                relatedRuleId:
                                    'test.rule'
                            }
                        ]);
                    }
                );

                it(
                    'accetta un singolo blocco fenced JSON',
                    async () => {
                        const result =
                            await reviewResponse(
                                [
                                    '```json',
                                    JSON.stringify(
                                        validPayload
                                    ),
                                    '```'
                                ].join('\n')
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'LLM'
                        );
                    }
                );

                it(
                    'ricalcola i campi deterministici',
                    async () => {
                        const result =
                            await reviewResponse(
                                JSON.stringify(
                                    validPayload
                                )
                            );

                        expect(
                            result.feedback
                                .violationsPrunedCount
                        ).toBe(
                            0
                        );

                        expect(
                            result.feedback
                                .securityPriorityStrict
                        ).toBe(
                            true
                        );

                        expect(
                            result.feedback
                                .flappingDetected
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'omette relatedRuleId quando è vuoto',
                    async () => {
                        const result =
                            await reviewResponse(
                                JSON.stringify({
                                    ...validPayload,

                                    targetRemediations: [
                                        {
                                            ...validRemediation,

                                            relatedRuleId:
                                                '   '
                                        }
                                    ]
                                })
                            );

                        expect(
                            result.feedback
                                .targetRemediations[0]
                        ).not.toHaveProperty(
                            'relatedRuleId'
                        );
                    }
                );
            }
        );

        describe(
            'estrazione JSON fail-closed',
            () => {
                it(
                    'rifiuta una risposta vuota',
                    async () => {
                        await expectFallback(
                            '   ',
                            'La risposta del Reviewer è vuota.'
                        );
                    }
                );

                it(
                    'rifiuta testo esterno al JSON',
                    async () => {
                        await expectFallback(
                            [
                                'Ecco la risposta:',
                                JSON.stringify(
                                    validPayload
                                )
                            ].join('\n'),
                            'esclusivamente un oggetto JSON'
                        );
                    }
                );

                it(
                    'rifiuta due oggetti concatenati',
                    async () => {
                        await expectFallback(
                            [
                                JSON.stringify(
                                    validPayload
                                ),
                                JSON.stringify({
                                    ignored:
                                        true
                                })
                            ].join('\n'),
                            /parsing del JSON/i
                        );
                    }
                );

                it(
                    'rifiuta JSON sintatticamente invalido',
                    async () => {
                        await expectFallback(
                            '{"rootCauseSummary":"broken",}',
                            /parsing del JSON/i
                        );
                    }
                );

                it(
                    'rifiuta una radice array',
                    async () => {
                        await expectFallback(
                            JSON.stringify([
                                validPayload
                            ]),
                            'esclusivamente un oggetto JSON'
                        );
                    }
                );

                it(
                    'rifiuta una radice null',
                    async () => {
                        await expectFallback(
                            'null',
                            'esclusivamente un oggetto JSON'
                        );
                    }
                );
            }
        );

        describe(
            'schema root',
            () => {
                it(
                    'rifiuta rootCauseSummary mancante',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                targetRemediations: [
                                    validRemediation
                                ]
                            }),
                            'rootCauseSummary deve essere una stringa non vuota'
                        );
                    }
                );

                it(
                    'rifiuta rootCauseSummary vuoto',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                rootCauseSummary:
                                    '   ',

                                targetRemediations: [
                                    validRemediation
                                ]
                            }),
                            'rootCauseSummary deve essere una stringa non vuota'
                        );
                    }
                );

                it(
                    'rifiuta targetRemediations mancante',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                rootCauseSummary:
                                    'Diagnosi valida.'
                            }),
                            'targetRemediations deve essere un array'
                        );
                    }
                );

                it(
                    'rifiuta targetRemediations non array',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                rootCauseSummary:
                                    'Diagnosi valida.',

                                targetRemediations: {
                                    invalid:
                                        true
                                }
                            }),
                            'targetRemediations deve essere un array'
                        );
                    }
                );

                it(
                    'rifiuta targetRemediations vuoto',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                rootCauseSummary:
                                    'Diagnosi valida.',

                                targetRemediations:
                                    []
                            }),
                            'targetRemediations deve contenere almeno una remediation'
                        );
                    }
                );

                it(
                    'rifiuta gli alias legacy',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                summary:
                                    'Alias legacy.',

                                remediations: [
                                    validRemediation
                                ]
                            }),
                            'rootCauseSummary deve essere una stringa non vuota'
                        );
                    }
                );
            }
        );

        describe(
            'schema remediation',
            () => {
                it(
                    'rifiuta remediation null',
                    async () => {
                        await expectFallback(
                            payloadWithRemediation(
                                null
                            ),
                            'deve essere un oggetto'
                        );
                    }
                );

                it(
                    'rifiuta file mancante',
                    async () => {
                        const {
                            file:
                            _ignored,
                            ...candidate
                        } =
                            validRemediation;

                        await expectFallback(
                            payloadWithRemediation(
                                candidate
                            ),
                            '.file deve essere una stringa non vuota'
                        );
                    }
                );

                it(
                    'rifiuta rootCause mancante',
                    async () => {
                        const {
                            rootCause:
                            _ignored,
                            ...candidate
                        } =
                            validRemediation;

                        await expectFallback(
                            payloadWithRemediation(
                                candidate
                            ),
                            '.rootCause deve essere una stringa non vuota'
                        );
                    }
                );

                it(
                    'rifiuta mandatoryCorrection mancante',
                    async () => {
                        const {
                            mandatoryCorrection:
                            _ignored,
                            ...candidate
                        } =
                            validRemediation;

                        await expectFallback(
                            payloadWithRemediation(
                                candidate
                            ),
                            '.mandatoryCorrection deve essere una stringa non vuota'
                        );
                    }
                );

                it(
                    'rifiuta lineRange mancante',
                    async () => {
                        const {
                            lineRange:
                            _ignored,
                            ...candidate
                        } =
                            validRemediation;

                        await expectFallback(
                            payloadWithRemediation(
                                candidate
                            ),
                            '.lineRange deve essere un oggetto'
                        );
                    }
                );

                it(
                    'rifiuta start non positivo',
                    async () => {
                        await expectFallback(
                            payloadWithRemediation({
                                ...validRemediation,

                                lineRange: {
                                    start:
                                        0,

                                    end:
                                        2
                                }
                            }),
                            'lineRange.start deve essere un numero positivo'
                        );
                    }
                );

                it(
                    'rifiuta start non intero',
                    async () => {
                        await expectFallback(
                            payloadWithRemediation({
                                ...validRemediation,

                                lineRange: {
                                    start:
                                        1.5,

                                    end:
                                        2
                                }
                            }),
                            'lineRange.start deve essere un numero positivo'
                        );
                    }
                );

                it(
                    'rifiuta end minore di start',
                    async () => {
                        await expectFallback(
                            payloadWithRemediation({
                                ...validRemediation,

                                lineRange: {
                                    start:
                                        2,

                                    end:
                                        1
                                }
                            }),
                            'lineRange.end deve essere un intero maggiore o uguale a start'
                        );
                    }
                );

                it(
                    'rifiuta relatedRuleId non stringa',
                    async () => {
                        await expectFallback(
                            payloadWithRemediation({
                                ...validRemediation,

                                relatedRuleId:
                                    42
                            }),
                            'relatedRuleId deve essere una stringa quando presente'
                        );
                    }
                );
            }
        );

        describe(
            'policy dopo la validazione runtime',
            () => {
                it(
                    'filtra una remediation REPAIR fuori target',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                ...validPayload,

                                targetRemediations: [
                                    {
                                        ...validRemediation,

                                        file:
                                            'src/other.py'
                                    }
                                ]
                            }),
                            'Nessuna targetRemediation valida'
                        );
                    }
                );

                it(
                    'filtra una remediation diretta a un test',
                    async () => {
                        await expectFallback(
                            JSON.stringify({
                                ...validPayload,

                                targetRemediations: [
                                    {
                                        ...validRemediation,

                                        file:
                                            'tests/test_target.py'
                                    }
                                ]
                            }),
                            'Nessuna targetRemediation valida'
                        );
                    }
                );

                it(
                    'mantiene la remediation autorizzata e scarta quella vietata',
                    async () => {
                        const result =
                            await reviewResponse(
                                JSON.stringify({
                                    rootCauseSummary:
                                        'Diagnosi mista.',

                                    targetRemediations: [
                                        {
                                            file:
                                                'tests/test_target.py',

                                            lineRange: {
                                                start:
                                                    1,

                                                end:
                                                    1
                                            },

                                            rootCause:
                                                'Test failure.',

                                            mandatoryCorrection:
                                                'Modify the test.'
                                        },
                                        {
                                            file:
                                                'src/target.py',

                                            lineRange: {
                                                start:
                                                    1,

                                                end:
                                                    1
                                            },

                                            rootCause:
                                                'Comportamento sorgente errato.',

                                            mandatoryCorrection:
                                                'Correggere il codice sorgente.'
                                        }
                                    ]
                                })
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
                                ?.file
                        ).toBe(
                            'src/target.py'
                        );
                    }
                );
            }
        );
    }
);
